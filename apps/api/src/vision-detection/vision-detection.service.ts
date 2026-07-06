import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  VISION_API_CLIENT,
  VisionApiError,
  type VisionApiClient,
} from './vision-api-client';
import { normalizeVisionResponse } from './vision-response-normalizer';
import type {
  RawVisionResponse,
  VisionAnalysisInput,
  VisionEngineError,
  VisionEngineResult,
} from './vision-detection.types';

/**
 * Entry point for the premium **Vision/LLM** auto-field-placement engine
 * (grain-3). Given a document rendered to page images, it calls the external
 * service, normalizes the answer into the shared {@link
 * import('./vision-detection.types').FieldDetectionResult} (`engine: 'vision'`),
 * and returns a safe union — it **never throws** for an expected failure.
 *
 * Scope boundary: this adapter only *runs* the engine and normalizes the result.
 * Deciding whether the engine may run at all (plan / free-trial balance) is
 * `VisionTrialService`'s job (grain-1); deciding *when* to call heuristic vs.
 * vision is the orchestration's job (grain-4). This service assumes the caller
 * has already cleared access.
 */
@Injectable()
export class VisionDetectionService {
  private readonly logger = new Logger(VisionDetectionService.name);

  constructor(
    @Inject(VISION_API_CLIENT) private readonly client: VisionApiClient,
  ) {}

  /**
   * Analyse a document (as page images) with the external Vision engine.
   * Returns `{ ok: true, result }` with normalized candidates, or
   * `{ ok: false, error }` carrying a structured {@link VisionEngineError}.
   */
  async analyze(input: VisionAnalysisInput): Promise<VisionEngineResult> {
    let raw: RawVisionResponse;
    try {
      raw = await this.client.analyze(input);
    } catch (err) {
      return { ok: false, error: this.toEngineError(err) };
    }

    try {
      return { ok: true, result: normalizeVisionResponse(raw) };
    } catch (err) {
      // A 2xx response that didn't match the agreed contract.
      this.logger.warn(`Vision 응답 정규화 실패: ${String(err)}`);
      return {
        ok: false,
        error: { reason: 'bad-response', detail: '응답 형식이 계약과 다름' },
      };
    }
  }

  private toEngineError(err: unknown): VisionEngineError {
    if (err instanceof VisionApiError) {
      // `unavailable` is an expected disabled-engine state, not an incident —
      // keep it quiet. Real failures (timeout/api-error) are worth a warning.
      if (err.reason !== 'unavailable') {
        this.logger.warn(
          `Vision API 실패(${err.reason})${err.status ? ` status=${err.status}` : ''}`,
        );
      }
      return { reason: err.reason, detail: err.detail, status: err.status };
    }
    this.logger.warn(`Vision API 예기치 못한 오류: ${String(err)}`);
    return { reason: 'api-error', detail: '예기치 못한 오류' };
  }
}
