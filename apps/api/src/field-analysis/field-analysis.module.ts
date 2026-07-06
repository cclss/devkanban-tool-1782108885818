import { Module } from '@nestjs/common';
import { FieldDetectionModule } from '../field-detection/field-detection.module';
import { VisionDetectionModule } from '../vision-detection/vision-detection.module';
import { FieldAnalysisService } from './field-analysis.service';
import {
  EmptyPdfPageRenderer,
  PDF_PAGE_RENDERER,
} from './pdf-page-renderer';

/**
 * Auto-field-placement analysis orchestration (grain-3). Composes the two engine
 * grains behind {@link FieldAnalysisService}:
 *
 *  - {@link FieldDetectionModule} — the default heuristic engine (detection).
 *  - {@link VisionDetectionModule} — the premium Vision engine.
 *
 * Free-trial gating is out of scope for this grain, so no trial policy module is
 * wired in: an image-only PDF unconditionally runs the premium engine.
 *
 * The {@link PDF_PAGE_RENDERER} port defaults to {@link EmptyPdfPageRenderer}
 * (renders nothing → Vision path resolves as unavailable/failed); bind a real
 * rasterizer here to enable end-to-end Vision analysis on image-only PDFs.
 *
 * Exports {@link FieldAnalysisService} so the upload flow can trigger analysis in
 * the background on a successful upload.
 */
@Module({
  imports: [FieldDetectionModule, VisionDetectionModule],
  providers: [
    FieldAnalysisService,
    { provide: PDF_PAGE_RENDERER, useClass: EmptyPdfPageRenderer },
  ],
  exports: [FieldAnalysisService],
})
export class FieldAnalysisModule {}
