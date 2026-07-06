import { Inject, Injectable, Logger } from '@nestjs/common';
import { HeuristicFieldDetector } from './heuristic-field-detector';
import { PDF_TEXT_EXTRACTOR, type PdfTextExtractor } from './pdf-text-extractor';
import type { FieldDetectionResult } from './field-detection.types';

/**
 * Entry point for the default (heuristic) auto-field-placement engine: given a
 * PDF's bytes, extract its text layer and run the keyword/pattern detector,
 * returning the shared {@link FieldDetectionResult}.
 *
 * This is the seam grain-3/grain-4 call. It never throws for a bad/scanned PDF:
 * an extractor failure is treated as "no usable text layer" (`no-text`), which
 * carries `fallbackToVision`, so the caller can offer the premium engine instead
 * of surfacing an error.
 */
@Injectable()
export class FieldDetectionService {
  private readonly logger = new Logger(FieldDetectionService.name);

  constructor(
    private readonly detector: HeuristicFieldDetector,
    @Inject(PDF_TEXT_EXTRACTOR) private readonly extractor: PdfTextExtractor,
  ) {}

  /** Analyse a PDF with the heuristic engine and return field candidates. */
  async analyze(pdf: Buffer): Promise<FieldDetectionResult> {
    let layer;
    try {
      layer = await this.extractor.extract(pdf);
    } catch (err) {
      // Unreadable/scanned PDF: fall back to the image-only signal rather than
      // failing the upload flow.
      this.logger.warn(`텍스트 레이어 추출 실패, 이미지 전용으로 처리: ${String(err)}`);
      return {
        engine: 'heuristic',
        signal: 'no-text',
        fields: [],
        meanConfidence: null,
        fallbackToVision: true,
      };
    }
    return this.detector.detect(layer);
  }
}
