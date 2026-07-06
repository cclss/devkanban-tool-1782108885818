import { Inject, Injectable, Logger } from '@nestjs/common';
import { FieldDetectionService } from '../field-detection/field-detection.service';
import { VisionDetectionService } from '../vision-detection/vision-detection.service';
import { VisionTrialService } from '../trials/vision-trial.service';
import type { FieldDetectionResult } from '../field-detection/field-detection.types';
import type { VisionEngineResult } from '../vision-detection/vision-detection.types';
import { PDF_PAGE_RENDERER, type PdfPageRenderer } from './pdf-page-renderer';
import type {
  FieldAnalysisResult,
  FieldAnalysisStatus,
} from './field-analysis.types';

/**
 * Tiered auto-field-placement **orchestration** (grain-4).
 *
 * On upload this service decides which engine runs and assembles the payload the
 * frontend consumes. The flow:
 *
 *   1. Always run the default heuristic engine (grain-2) on the PDF bytes.
 *   2. If it is confident (`fallbackToVision === false`), return those
 *      candidates — text PDFs never touch the premium engine or the trial meter.
 *   3. Otherwise the document is image-only / low-confidence. Ask the plan/trial
 *      policy (grain-1) whether the premium Vision engine may run:
 *        • not allowed → return `blocked` with `upgradeRequired`, no engine call.
 *        • allowed     → render the pages and run the Vision engine (grain-3).
 *             – success → charge exactly one free trial (FREE plan only) and
 *                         return the Vision candidates.
 *             – failure → charge nothing; return the heuristic result with the
 *                         structured error reason.
 *
 * Scope boundary: this service only *selects* an engine, *meters* the trial, and
 * *assembles* the status payload. It never re-implements the plan/trial rules
 * ({@link VisionTrialService} owns them) nor an engine's internals — it composes
 * the three grains behind one entry point.
 *
 * Trial charging is intentionally **after** a successful Vision run (not before),
 * so a user is never charged for a timeout / unavailable / bad-response failure.
 * The atomic guard in {@link VisionTrialService.consumeTrial} still prevents any
 * over-charge if two uploads race for the last trial.
 */
@Injectable()
export class FieldAnalysisService {
  private readonly logger = new Logger(FieldAnalysisService.name);

  constructor(
    private readonly fieldDetection: FieldDetectionService,
    private readonly visionDetection: VisionDetectionService,
    private readonly trials: VisionTrialService,
    @Inject(PDF_PAGE_RENDERER) private readonly renderer: PdfPageRenderer,
  ) {}

  /**
   * Analyse a freshly uploaded PDF and return field candidates plus the
   * engine/trial/upgrade status for the frontend.
   */
  async analyze(userId: string, pdf: Buffer): Promise<FieldAnalysisResult> {
    const heuristic = await this.fieldDetection.analyze(pdf);

    // Text PDF, confident result: the premium engine and the trial meter are
    // never involved. We still surface the trial balance so the payload shape is
    // uniform for the frontend.
    if (!heuristic.fallbackToVision) {
      const { isPremium, remaining } = await this.trials.getStatus(userId);
      return this.build(heuristic, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'not-needed',
        isPremium,
        trialsRemaining: remaining,
        trialConsumed: false,
        upgradeRequired: false,
      });
    }

    // Image-only / low-confidence: consult the single plan/trial access policy.
    const access = await this.trials.canUseVisionEngine(userId);
    if (!access.allowed) {
      return this.build(heuristic, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'blocked',
        isPremium: access.isPremium,
        trialsRemaining: access.remaining,
        trialConsumed: false,
        upgradeRequired: true,
      });
    }

    // Access cleared — render the pages and run the premium engine.
    const vision = await this.runVision(pdf);
    if (!vision.ok) {
      return this.build(heuristic, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'failed',
        isPremium: access.isPremium,
        trialsRemaining: access.remaining,
        trialConsumed: false,
        upgradeRequired: false,
        visionError: vision.error.reason,
      });
    }

    // Vision succeeded — charge exactly one trial for FREE accounts (premium is
    // unmetered). Charging only now guarantees a failed run costs nothing.
    let trialsRemaining = access.remaining;
    let trialConsumed = false;
    if (!access.isPremium) {
      const charge = await this.trials.consumeTrial(userId);
      trialsRemaining = charge.remaining;
      trialConsumed = charge.consumed;
    }

    return this.build(vision.result, {
      engine: vision.result.engine,
      signal: vision.result.signal,
      visionStage: 'succeeded',
      isPremium: access.isPremium,
      trialsRemaining,
      trialConsumed,
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
    userId: string,
    documentId: string,
    loadPdf: () => Promise<Buffer>,
  ): void {
    void this.runBackground(userId, documentId, loadPdf);
  }

  private async runBackground(
    userId: string,
    documentId: string,
    loadPdf: () => Promise<Buffer>,
  ): Promise<void> {
    try {
      const pdf = await loadPdf();
      const { status } = await this.analyze(userId, pdf);
      this.logger.log(
        `문서 ${documentId} 자동 필드 분석 완료: engine=${status.engine} ` +
          `stage=${status.visionStage} remaining=${status.trialsRemaining} ` +
          `upgradeRequired=${status.upgradeRequired}`,
      );
    } catch (err) {
      this.logger.warn(`문서 ${documentId} 자동 필드 분석 실패: ${String(err)}`);
    }
  }

  /**
   * Render the PDF and run the Vision engine. A renderer that yields no images
   * (the default, unbound renderer) is treated as an `unavailable` Vision path —
   * no outbound call, and (because it is not `ok`) no trial is charged.
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

  private build(
    source: FieldDetectionResult,
    status: FieldAnalysisStatus,
  ): FieldAnalysisResult {
    return { fields: source.fields, status };
  }
}
