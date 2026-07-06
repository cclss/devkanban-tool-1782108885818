import { Module } from '@nestjs/common';
import {
  HttpVisionApiClient,
  VISION_API_CLIENT,
} from './vision-api-client';
import { VisionDetectionService } from './vision-detection.service';

/**
 * The premium (Vision/LLM) auto-field-placement engine. Provides
 * {@link VisionDetectionService} — the page-images→candidates entry point the
 * heuristic→vision orchestration (grain-4) consumes when a document is
 * image-only / low-confidence and the account has cleared access.
 *
 * The {@link VISION_API_CLIENT} port defaults to {@link HttpVisionApiClient},
 * which reads `VISION_API_ENDPOINT` / `VISION_API_KEY` from the global config.
 * With no credentials configured the engine is disabled-by-default: it returns
 * a safe `unavailable` error instead of calling out, so wiring the module in is
 * safe before the external service is provisioned.
 */
@Module({
  providers: [
    VisionDetectionService,
    { provide: VISION_API_CLIENT, useClass: HttpVisionApiClient },
  ],
  exports: [VisionDetectionService, VISION_API_CLIENT],
})
export class VisionDetectionModule {}
