import { Module } from '@nestjs/common';
import { HeuristicFieldDetector } from './heuristic-field-detector';
import { ScanDetector } from './scan-detector';
import { FieldDetectionService } from './field-detection.service';
import { PDF_TEXT_EXTRACTOR } from './pdf-text-extractor';
import { PdfjsTextExtractor } from './pdfjs-text-extractor';

/**
 * The default (heuristic) auto-field-placement engine. Provides
 * {@link FieldDetectionService} — the buffer→candidates entry point the
 * heuristic→vision orchestration (grain-4) consumes.
 *
 * The {@link PDF_TEXT_EXTRACTOR} port is bound to {@link PdfjsTextExtractor}, the
 * real `pdfjs-dist` positioned-text extractor, so the heuristic engine detects
 * fields end-to-end on text PDFs; a scanned / image-only PDF yields an empty text
 * layer and routes cleanly to the `no-text` fallback. No database or external
 * network dependency — the engine runs entirely in-process.
 */
@Module({
  providers: [
    HeuristicFieldDetector,
    ScanDetector,
    FieldDetectionService,
    { provide: PDF_TEXT_EXTRACTOR, useClass: PdfjsTextExtractor },
  ],
  exports: [FieldDetectionService, HeuristicFieldDetector, ScanDetector],
})
export class FieldDetectionModule {}
