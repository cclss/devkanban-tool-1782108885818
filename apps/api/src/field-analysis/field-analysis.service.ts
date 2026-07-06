import { Inject, Injectable, Logger } from '@nestjs/common';
import { FieldDetectionService } from '../field-detection/field-detection.service';
import { VisionDetectionService } from '../vision-detection/vision-detection.service';
import type { FieldDetectionResult } from '../field-detection/field-detection.types';
import type { VisionEngineResult } from '../vision-detection/vision-detection.types';
import { PDF_PAGE_RENDERER, type PdfPageRenderer } from './pdf-page-renderer';
import type {
  FieldAnalysisResult,
  FieldAnalysisStatus,
} from './field-analysis.types';

/**
 * Auto-field-placement **analysis orchestration** (grain-3).
 *
 * On upload this service decides which engine runs and assembles the payload the
 * frontend consumes. The flow:
 *
 *   1. Always run the default heuristic engine on the PDF bytes.
 *   2. If it is confident (`fallbackToVision === false`), return those
 *      candidates — a text PDF never touches the premium engine (Vision is
 *      `not-needed`).
 *   3. Otherwise the document is image-only / low-confidence. Rasterize the pages
 *      and run the premium Vision engine:
 *        • success → return the Vision candidates (`succeeded`).
 *        • failure → return empty candidates plus the structured error reason
 *                    (`failed`, `visionError`).
 *
 * Scope boundary: this service only *selects* an engine, *renders* the pages, and
 * *assembles* the status payload behind one entry point. It never re-implements an
 * engine's internals.
 *
 * Free-trial metering and upgrade gating are **out of scope for this grain**: an
 * image-only PDF unconditionally runs the premium engine, and the payload carries
 * no trial/upgrade fields. A later grain layers the trial policy on top.
 */
@Injectable()
export class FieldAnalysisService {
  private readonly logger = new Logger(FieldAnalysisService.name);

  constructor(
    private readonly fieldDetection: FieldDetectionService,
    private readonly visionDetection: VisionDetectionService,
    @Inject(PDF_PAGE_RENDERER) private readonly renderer: PdfPageRenderer,
  ) {}

  /**
   * Analyse a freshly uploaded PDF and return field candidates plus the
   * engine / Vision-stage status for the frontend.
   */
  async analyze(pdf: Buffer): Promise<FieldAnalysisResult> {
    const heuristic = await this.fieldDetection.analyze(pdf);

    // Text PDF, confident result: the premium engine is never involved.
    if (!heuristic.fallbackToVision) {
      return this.build(heuristic, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'not-needed',
      });
    }

    // Image-only / low-confidence: unconditionally attempt the premium engine
    // (trial gating is a later grain — here an image-only PDF always runs Vision).
    const vision = await this.runVision(pdf);
    if (!vision.ok) {
      return this.build(heuristic, {
        engine: heuristic.engine,
        signal: heuristic.signal,
        visionStage: 'failed',
        visionError: vision.error.reason,
      });
    }

    return this.build(vision.result, {
      engine: vision.result.engine,
      signal: vision.result.signal,
      visionStage: 'succeeded',
    });
  }

  /**
   * Fire-and-forget trigger for the upload flow: run {@link analyze} in the
   * background so a slow engine never blocks the upload response, and swallow all
   * errors (an analysis failure must never fail an upload). `loadPdf` defers the
   * (possibly remote) byte fetch into the background task.
   */
  analyzeInBackground(documentId: string, loadPdf: () => Promise<Buffer>): void {
    void this.runBackground(documentId, loadPdf);
  }

  private async runBackground(
    documentId: string,
    loadPdf: () => Promise<Buffer>,
  ): Promise<void> {
    try {
      const pdf = await loadPdf();
      const { status } = await this.analyze(pdf);
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

  private build(
    source: FieldDetectionResult,
    status: FieldAnalysisStatus,
  ): FieldAnalysisResult {
    return { fields: source.fields, status };
  }
}
