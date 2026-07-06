import { Module } from '@nestjs/common';
import { FieldDetectionModule } from '../field-detection/field-detection.module';
import { VisionDetectionModule } from '../vision-detection/vision-detection.module';
import { VisionTrialModule } from '../trials/vision-trial.module';
import { FieldAnalysisService } from './field-analysis.service';
import {
  EmptyPdfPageRenderer,
  PDF_PAGE_RENDERER,
} from './pdf-page-renderer';
import {
  FIELD_ANALYSIS_STORE,
  PrismaFieldAnalysisStore,
} from './field-analysis.store';
import {
  DOCUMENT_PDF_SOURCE,
  StorageDocumentPdfSource,
} from './document-pdf-source';

/**
 * Auto-field-placement analysis orchestration with the trial policy folded in
 * (grain-2). Composes the two engine grains, the persistent trial meter, and the
 * grain-1 persistence store behind {@link FieldAnalysisService}:
 *
 *  - {@link FieldDetectionModule} — the default heuristic engine (detection).
 *  - {@link VisionDetectionModule} — the premium Vision engine.
 *  - {@link VisionTrialModule} — the atomic plan/free-trial access policy; the
 *    orchestration meters premium use ONLY through its `acquireVisionUse`.
 *
 * An image-only PDF is never auto-analysed by Vision on upload; it is recorded as
 * awaiting consent (or blocked) and the actual Vision run happens in
 * {@link FieldAnalysisService.runPremiumAnalysis} after the user opts in.
 *
 * Ports (PrismaModule / StorageModule are global, so no extra imports needed):
 *  - {@link FIELD_ANALYSIS_STORE} → {@link PrismaFieldAnalysisStore}: persists the
 *    candidates + engine/stage snapshot (grain-1 schema).
 *  - {@link DOCUMENT_PDF_SOURCE} → {@link StorageDocumentPdfSource}: re-reads the
 *    PDF bytes for the consent-driven premium run.
 *  - {@link PDF_PAGE_RENDERER} → {@link EmptyPdfPageRenderer}: renders nothing
 *    until a real rasterizer is bound (Vision path then resolves as unavailable).
 *
 * Exports {@link FieldAnalysisService} so the upload flow can trigger analysis in
 * the background on a successful upload.
 */
@Module({
  imports: [FieldDetectionModule, VisionDetectionModule, VisionTrialModule],
  providers: [
    FieldAnalysisService,
    { provide: PDF_PAGE_RENDERER, useClass: EmptyPdfPageRenderer },
    { provide: FIELD_ANALYSIS_STORE, useClass: PrismaFieldAnalysisStore },
    { provide: DOCUMENT_PDF_SOURCE, useClass: StorageDocumentPdfSource },
  ],
  exports: [FieldAnalysisService],
})
export class FieldAnalysisModule {}
