import type {
  DetectionEngine,
  DetectionSignal,
  FieldCandidate,
} from '../field-detection/field-detection.types';
import type { VisionErrorReason } from '../vision-detection/vision-detection.types';

/**
 * Data contract for the auto-field-placement **analysis orchestration** (grain-3).
 *
 * On upload the orchestration runs the default heuristic engine (grain-1 detection
 * + heuristic) first and, for an image-only / low-confidence PDF, rasterizes the
 * pages and falls back to the premium Vision engine (grain-2). It assembles the
 * field candidates plus a {@link FieldAnalysisStatus} the frontend consumes to
 * drive the review UI.
 *
 * These are **structured signals**, not user-facing copy: which engine ran, the
 * Vision stage outcome, and — on failure — a structured reason. The actual
 * prompts shown to a user are composed by later UI grains from this payload.
 *
 * Free-trial usage, upgrade gating, and any trial counters are deliberately **out
 * of scope for this grain** and are absent from the payload: an image-only PDF
 * unconditionally runs the premium engine here. A later grain layers the trial
 * policy on top of this orchestration.
 */

/** Which engine produced the returned candidates. */
export type AnalysisEngine = DetectionEngine;

/**
 * What happened at the (optional) Vision fallback stage.
 *
 *  - `not-needed`  — the heuristic engine was confident; Vision was never
 *                    considered. (Text PDF happy path.)
 *  - `succeeded`   — Vision ran and produced candidates (image-only / low
 *                    confidence PDF).
 *  - `failed`      — Vision ran but could not produce a result (not configured /
 *                    timeout / transport / bad response). No candidates are
 *                    returned and `visionError` carries the structured reason.
 *
 * There is no `blocked` state in this grain: access gating (plan / free trials)
 * is out of scope, so an image-only PDF always attempts the premium engine.
 */
export type VisionStage = 'not-needed' | 'succeeded' | 'failed';

/**
 * The frontend-consumable status of one document analysis. Serializable and free
 * of PII / internal handles — safe to return straight to the client.
 */
export interface FieldAnalysisStatus {
  /** Which engine produced the returned candidates. */
  engine: AnalysisEngine;
  /** Final verdict of the engine that produced the candidates. */
  signal: DetectionSignal;
  /** Outcome of the Vision fallback stage (see {@link VisionStage}). */
  visionStage: VisionStage;
  /** Structured failure reason, present only when `visionStage === 'failed'`. */
  visionError?: VisionErrorReason;
}

/**
 * The orchestration's complete output for one document: the proposed fields plus
 * the status the frontend needs to render suggestions.
 */
export interface FieldAnalysisResult {
  /** Proposed input fields (possibly empty — e.g. a failed Vision run). */
  fields: FieldCandidate[];
  /** Engine / Vision-stage status for the UI. */
  status: FieldAnalysisStatus;
}

export type { FieldCandidate };
