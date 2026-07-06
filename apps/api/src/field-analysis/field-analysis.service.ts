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
} from './field-analysis.types';

/**
 * Auto-field-placement **analysis orchestration**. Premium auto-placement is
 * **unlimited for every plan** — nothing here meters a trial or raises an upgrade
 * wall.
 *
 * On upload {@link analyze} runs the default heuristic engine, persists the
 * result, and — crucially — does **not** auto-run the premium Vision engine on an
 * image-only / low-confidence PDF (the external call ships page pixels = PII, so
 * it waits for consent). It records:
 *
 *   1. Confident text PDF → `not-needed`, heuristic candidates persisted.
 *   2. Scanned / low-confidence PDF → **always** `available` (persisted
 *      `AWAITING_CONSENT`). No trial is spent; the flow waits for the user to opt
 *      in. There is no `blocked` state anymore — premium is unlimited.
 *
 * {@link runPremiumAnalysis} is the consent-driven step: premium is unlimited, so
 * it never consumes and never blocks — it reads the plan/balance via
 * {@link VisionTrialService.acquireVisionUse} (for the status payload only), then
 * renders the pages and runs Vision, persisting the outcome (`succeeded` /
 * `failed`).
 *
 * Scope boundary: this service *selects* an engine, *renders* pages, and
 * *persists* the snapshot — it never re-implements an engine's internals, touches
 * billing, or renders UI.
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
   * status, and return the payload the frontend consumes. A scanned /
   * low-confidence PDF is **always** recorded as `available` (awaiting consent) —
   * Vision is **not** run here (consent happens later in
   * {@link runPremiumAnalysis}). Premium is unlimited, so there is no `blocked`
   * outcome and `upgradeRequired` is always false.
   */
  async analyze(
    documentId: string,
    userId: string,
    pdf: Buffer,
  ): Promise<FieldAnalysisResult> {
    const heuristic = await this.fieldDetection.analyze(pdf);

    // Confident text PDF: the base engine handled it and the premium engine is
    // never required. The base placement is unlimited — no trial is spent here.
    // We only expose whether the account *may optionally* run premium for a more
    // accurate pass (`boostAvailable`); the editor turns that into a non-coercive
    // accuracy-boost invite. Never true once trials are gone on a non-premium plan
    // (there is no upsell wall on a text PDF — base stays free and unlimited).
    if (!heuristic.fallbackToVision) {
      const trial = await this.trials.getStatus(userId);
      return this.persistAndReturn(documentId, heuristic.fields, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'not-needed',
        isPremium: trial.isPremium,
        trialsRemaining: trial.remaining,
        upgradeRequired: false,
        boostAvailable: trial.isPremium || trial.remaining > 0,
      });
    }

    // Scanned / low-confidence: do NOT run Vision now (the external call ships
    // page pixels = PII, so it needs consent). Premium is unlimited, so this
    // ALWAYS resolves to `available` (awaiting consent) — never `blocked`, and
    // `upgradeRequired` is always false. No trial is spent. `canUseVisionEngine`
    // is read only to surface the plan (premium hides the trial note) and the
    // dormant balance.
    const access = await this.trials.canUseVisionEngine(userId);
    return this.persistAndReturn(documentId, heuristic.fields, {
      engine: heuristic.engine,
      signal: heuristic.signal,
      visionStage: 'available',
      isPremium: access.isPremium,
      trialsRemaining: access.remaining,
      upgradeRequired: false,
      // Scanned document: the premium path runs through `visionStage`, not the
      // text-PDF accuracy boost.
      boostAvailable: false,
    });
  }

  /**
   * Consent-driven premium run (invoked from the editor once the user opts in).
   * Premium auto-placement is unlimited: this **never consumes** a trial and
   * **never blocks**. It reads the plan/balance via
   * {@link VisionTrialService.acquireVisionUse} (for the status payload only),
   * then renders the document and runs the Vision engine, persisting the outcome
   * (`succeeded` / `failed`).
   */
  async runPremiumAnalysis(
    documentId: string,
    userId: string,
  ): Promise<FieldAnalysisResult> {
    // Unlimited access: allowed without consuming a trial. Read only to surface
    // the plan / dormant balance in the returned status.
    const access = await this.trials.acquireVisionUse(userId);

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
        boostAvailable: false,
      });
    }

    return this.persistAndReturn(documentId, vision.result.fields, {
      engine: vision.result.engine,
      signal: vision.result.signal,
      visionStage: 'succeeded',
      isPremium: access.isPremium,
      trialsRemaining: access.remaining,
      upgradeRequired: false,
      boostAvailable: false,
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
