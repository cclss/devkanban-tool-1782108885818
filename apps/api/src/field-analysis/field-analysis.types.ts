import type {
  DetectionEngine,
  DetectionSignal,
  FieldCandidate,
} from '../field-detection/field-detection.types';
import type { VisionErrorReason } from '../vision-detection/vision-detection.types';

/**
 * Data contract for the tiered auto-field-placement **orchestration** (grain-4).
 *
 * The orchestration runs the default heuristic engine (grain-2) first and, for an
 * image-only / low-confidence PDF, decides — via the plan/free-trial policy
 * (grain-1) — whether to fall back to the premium Vision engine (grain-3). It
 * assembles the field candidates plus a {@link FieldAnalysisStatus} the frontend
 * consumes to drive the review UI, the trial counter, and the upgrade path.
 *
 * These are **structured signals**, not user-facing copy: which engine ran, how
 * many trials remain, whether an upgrade is required. The actual prompts/modals
 * shown to a user are composed by the UI grains (grain-6/7) from this payload.
 */

/** Which engine produced the returned candidates. */
export type AnalysisEngine = DetectionEngine;

/**
 * What happened at the (optional) Vision fallback stage.
 *
 *  - `not-needed`  — the heuristic engine was confident; Vision was never
 *                    considered. (Text PDF happy path.)
 *  - `blocked`     — Vision was needed but access was denied (free trials
 *                    exhausted and not on a premium plan). No engine call was
 *                    made; `upgradeRequired` is set so the UI can offer an
 *                    upgrade.
 *  - `succeeded`   — Vision ran and produced candidates. For a FREE account this
 *                    is the moment a free trial is charged (`trialConsumed`).
 *  - `failed`      — Vision was allowed but the engine could not produce a
 *                    result (not configured / timeout / transport / bad
 *                    response). No trial is charged; the heuristic result (often
 *                    empty) is returned and `visionError` carries the reason.
 */
export type VisionStage = 'not-needed' | 'blocked' | 'succeeded' | 'failed';

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
  /** Whether the account is on a premium (unmetered) plan. */
  isPremium: boolean;
  /** Remaining free Vision trials after this run (0 for premium/exhausted). */
  trialsRemaining: number;
  /** Whether this run actually spent a free trial (FREE plan + Vision success). */
  trialConsumed: boolean;
  /**
   * Vision was needed but the account may not use it (trials exhausted, no
   * premium). The UI surfaces the upgrade path when this is true.
   */
  upgradeRequired: boolean;
  /** Structured failure reason, present only when `visionStage === 'failed'`. */
  visionError?: VisionErrorReason;
}

/**
 * The orchestration's complete output for one document: the proposed fields plus
 * the status the frontend needs to render suggestions, the trial counter, and any
 * upgrade prompt.
 */
export interface FieldAnalysisResult {
  /** Proposed input fields (possibly empty — e.g. blocked or failed Vision). */
  fields: FieldCandidate[];
  /** Engine/trial/upgrade status for the UI. */
  status: FieldAnalysisStatus;
}

export type { FieldCandidate };
