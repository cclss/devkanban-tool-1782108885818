import { Inject, Injectable, Logger } from '@nestjs/common';
import { FieldDetectionService } from '../field-detection/field-detection.service';
import { VisionDetectionService } from '../vision-detection/vision-detection.service';
import { VisionTrialService } from '../trials/vision-trial.service';
import type { FieldCandidate } from '../field-detection/field-detection.types';
import type { VisionEngineResult } from '../vision-detection/vision-detection.types';
import { PDF_PAGE_RENDERER, type PdfPageRenderer } from './pdf-page-renderer';
import {
  FIELD_ANALYSIS_STORE,
  type FieldAnalysisStore,
} from './field-analysis.store';
import {
  DOCUMENT_PDF_SOURCE,
  type DocumentPdfSource,
} from './document-pdf-source';
import type {
  AnalysisEngine,
  FieldAnalysisResult,
  FieldAnalysisStatus,
  VisionStage,
} from './field-analysis.types';

/**
 * Auto-field-placement **analysis orchestration with the free-trial policy folded
 * in** (grain-2).
 *
 * On upload {@link analyze} runs the default heuristic engine, persists the
 * result, and — crucially — does **not** auto-run the premium Vision engine on an
 * image-only / low-confidence PDF. Instead it records whether the account may run
 * premium later:
 *
 *   1. Confident text PDF → `not-needed`, heuristic candidates persisted.
 *   2. Scanned / low-confidence PDF, account may use premium (premium plan or free
 *      trials remaining) → `available` (persisted `AWAITING_CONSENT`). No trial is
 *      spent; the flow waits for the user to opt in.
 *   3. Scanned / low-confidence PDF, no trials left and not premium → `blocked`
 *      (`upgradeRequired`), the upgrade path is offered.
 *
 * {@link runPremiumAnalysis} is the consent-driven step: it atomically spends one
 * free trial via {@link VisionTrialService.acquireVisionUse} (premium accounts do
 * not spend), then renders the pages and runs Vision, persisting the outcome
 * (`succeeded` / `failed`). An exhausted account short-circuits to `blocked`.
 *
 * Scope boundary: this service *selects* an engine, *renders* pages, *meters* the
 * trial through the existing atomic primitive, and *persists* the snapshot — it
 * never re-implements an engine's internals, touches billing, or renders UI.
 */
@Injectable()
export class FieldAnalysisService {
  private readonly logger = new Logger(FieldAnalysisService.name);

  constructor(
    private readonly fieldDetection: FieldDetectionService,
    private readonly visionDetection: VisionDetectionService,
    private readonly trials: VisionTrialService,
    @Inject(PDF_PAGE_RENDERER) private readonly renderer: PdfPageRenderer,
    @Inject(FIELD_ANALYSIS_STORE) private readonly store: FieldAnalysisStore,
    @Inject(DOCUMENT_PDF_SOURCE) private readonly pdfSource: DocumentPdfSource,
  ) {}

  /**
   * Upload-time analysis: run the heuristic engine, persist the candidates + the
   * (possibly gating) status, and return the payload the frontend consumes. A
   * scanned / low-confidence PDF is recorded as `available` or `blocked` — Vision
   * is **not** run here (consent is spent later in {@link runPremiumAnalysis}).
   */
  async analyze(
    documentId: string,
    userId: string,
    pdf: Buffer,
  ): Promise<FieldAnalysisResult> {
    const heuristic = await this.fieldDetection.analyze(pdf);

    // Confident text PDF: the premium engine is never involved.
    if (!heuristic.fallbackToVision) {
      const trial = await this.trials.getStatus(userId);
      return this.persistAndReturn(documentId, heuristic.fields, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'not-needed',
        isPremium: trial.isPremium,
        trialsRemaining: trial.remaining,
        upgradeRequired: false,
      });
    }

    // Scanned / low-confidence: do NOT run Vision now. Record whether the account
    // may run premium (`available`) or must upgrade (`blocked`). The engine stays
    // heuristic and the candidates are its (usually empty) output.
    const access = await this.trials.canUseVisionEngine(userId);
    const visionStage: VisionStage = access.allowed ? 'available' : 'blocked';
    return this.persistAndReturn(documentId, heuristic.fields, {
      engine: heuristic.engine,
      signal: heuristic.signal,
      visionStage,
      isPremium: access.isPremium,
      trialsRemaining: access.remaining,
      upgradeRequired: !access.allowed,
    });
  }

  /**
   * Consent-driven premium run (invoked from the editor once the user opts in).
   * Atomically spends one free trial (premium accounts do not spend), then renders
   * the document and runs the Vision engine, persisting the outcome.
   *
   * Ordering follows the trial policy: the trial is consumed via the atomic
   * {@link VisionTrialService.acquireVisionUse} primitive first. If the account is
   * exhausted (no trials, not premium) nothing is rendered and the result is
   * `blocked` / `upgradeRequired`.
   */
  async runPremiumAnalysis(
    documentId: string,
    userId: string,
  ): Promise<FieldAnalysisResult> {
    const access = await this.trials.acquireVisionUse(userId);

    // Exhausted, not premium: offer the upgrade path, render nothing.
    if (!access.allowed) {
      return this.persistAndReturn(documentId, [], {
        engine: 'heuristic',
        signal: 'no-text',
        visionStage: 'blocked',
        isPremium: access.isPremium,
        trialsRemaining: access.remaining,
        upgradeRequired: true,
      });
    }

    const pdf = await this.pdfSource.load(documentId);
    const vision: VisionEngineResult = pdf
      ? await this.runVision(pdf)
      : {
          ok: false,
          error: { reason: 'unavailable', detail: 'PDF 원본을 불러올 수 없음' },
        };

    if (!vision.ok) {
      return this.persistAndReturn(documentId, [], {
        engine: 'heuristic',
        signal: 'no-text',
        visionStage: 'failed',
        visionError: vision.error.reason,
        isPremium: access.isPremium,
        trialsRemaining: access.remaining,
        upgradeRequired: false,
      });
    }

    return this.persistAndReturn(documentId, vision.result.fields, {
      engine: vision.result.engine,
      signal: vision.result.signal,
      visionStage: 'succeeded',
      isPremium: access.isPremium,
      trialsRemaining: access.remaining,
      upgradeRequired: false,
    });
  }

  /**
   * Fire-and-forget trigger for the upload flow: run {@link analyze} in the
   * background so a slow engine never blocks the upload response, and swallow all
   * errors (an analysis failure must never fail an upload). `loadPdf` defers the
   * (possibly remote) byte fetch into the background task.
   */
  analyzeInBackground(
    documentId: string,
    userId: string,
    loadPdf: () => Promise<Buffer>,
  ): void {
    void this.runBackground(documentId, userId, loadPdf);
  }

  private async runBackground(
    documentId: string,
    userId: string,
    loadPdf: () => Promise<Buffer>,
  ): Promise<void> {
    try {
      const pdf = await loadPdf();
      const { status } = await this.analyze(documentId, userId, pdf);
      this.logger.log(
        `문서 ${documentId} 자동 필드 분석 완료: engine=${status.engine} ` +
          `stage=${status.visionStage}` +
          (status.visionError ? ` error=${status.visionError}` : ''),
      );
    } catch (err) {
      this.logger.warn(`문서 ${documentId} 자동 필드 분석 실패: ${String(err)}`);
    }
  }

  /**
   * Render the PDF and run the Vision engine. A renderer that yields no images
   * (the default, unbound renderer) is treated as an `unavailable` Vision path —
   * no outbound call is made and the stage resolves to `failed`.
   */
  private async runVision(pdf: Buffer): Promise<VisionEngineResult> {
    const pages = await this.renderer.render(pdf);
    if (pages.length === 0) {
      return {
        ok: false,
        error: { reason: 'unavailable', detail: 'PDF 페이지 렌더러 미바인딩' },
      };
    }
    return this.visionDetection.analyze({ pages });
  }

  /** Persist the snapshot (candidates + status) and return the frontend payload. */
  private async persistAndReturn(
    documentId: string,
    fields: FieldCandidate[],
    status: FieldAnalysisStatus,
  ): Promise<FieldAnalysisResult> {
    await this.store.saveAnalysis(documentId, {
      engine: status.engine as AnalysisEngine,
      visionStage: status.visionStage,
      fields,
    });
    return { fields, status };
  }
}
