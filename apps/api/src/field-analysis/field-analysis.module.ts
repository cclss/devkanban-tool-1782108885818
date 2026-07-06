import { Module } from '@nestjs/common';
import { FieldDetectionModule } from '../field-detection/field-detection.module';
import { VisionDetectionModule } from '../vision-detection/vision-detection.module';
import { VisionTrialModule } from '../trials/vision-trial.module';
import { FieldAnalysisService } from './field-analysis.service';
import {
  EmptyPdfPageRenderer,
  PDF_PAGE_RENDERER,
} from './pdf-page-renderer';

/**
 * Tiered auto-field-placement orchestration (grain-4). Composes the three
 * engine/policy grains behind {@link FieldAnalysisService}:
 *
 *  - {@link FieldDetectionModule} — the default heuristic engine (grain-2).
 *  - {@link VisionDetectionModule} — the premium Vision engine (grain-3).
 *  - {@link VisionTrialModule} — the plan/free-trial access policy (grain-1).
 *
 * The {@link PDF_PAGE_RENDERER} port defaults to {@link EmptyPdfPageRenderer}
 * (renders nothing → Vision path is safely unavailable, no trial charged); bind a
 * real rasterizer here to enable end-to-end Vision analysis on image-only PDFs.
 *
 * Exports {@link FieldAnalysisService} so the upload flow can trigger analysis in
 * the background on a successful upload.
 */
@Module({
  imports: [FieldDetectionModule, VisionDetectionModule, VisionTrialModule],
  providers: [
    FieldAnalysisService,
    { provide: PDF_PAGE_RENDERER, useClass: EmptyPdfPageRenderer },
  ],
  exports: [FieldAnalysisService],
})
export class FieldAnalysisModule {}
