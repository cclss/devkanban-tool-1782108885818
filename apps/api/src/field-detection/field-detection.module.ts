import { Module } from '@nestjs/common';
import { HeuristicFieldDetector } from './heuristic-field-detector';
import { FieldDetectionService } from './field-detection.service';
import {
  EmptyPdfTextExtractor,
  PDF_TEXT_EXTRACTOR,
} from './pdf-text-extractor';

/**
 * The default (heuristic) auto-field-placement engine. Provides
 * {@link FieldDetectionService} — the buffer→candidates entry point the
 * heuristic→vision orchestration (grain-4) consumes.
 *
 * The {@link PDF_TEXT_EXTRACTOR} port defaults to {@link EmptyPdfTextExtractor}
 * (reports image-only); bind a real positioned-text extractor here to enable
 * end-to-end detection on text PDFs. No database or external dependency — the
 * engine runs entirely in-process.
 */
@Module({
  providers: [
    HeuristicFieldDetector,
    FieldDetectionService,
    { provide: PDF_TEXT_EXTRACTOR, useClass: EmptyPdfTextExtractor },
  ],
  exports: [FieldDetectionService, HeuristicFieldDetector],
})
export class FieldDetectionModule {}
