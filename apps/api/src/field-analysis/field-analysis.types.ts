import type {
  DetectionEngine,
  DetectionSignal,
  FieldCandidate,
} from '../field-detection/field-detection.types';
import type { VisionErrorReason } from '../vision-detection/vision-detection.types';

/**
 * Data contract for the auto-field-placement **analysis orchestration** with the
 * free-trial policy folded in (grain-2).
 *
 * On upload the orchestration runs the default heuristic engine first and
 * persists the result. For an image-only / low-confidence PDF it does **not**
 * auto-run the premium Vision engine; instead it records a "scan detected,
 * premium awaiting" state and leaves the actual Vision run to an explicit,
 * consent-driven call ({@link FieldAnalysisResult}) that atomically spends a free
 * trial. The status carries the plan / trial situation the review UI branches on.
 *
 * These are **structured signals**, not user-facing copy: which engine ran, the
 * Vision stage outcome, whether the account is premium, how many free trials
 * remain, and whether an upgrade is required. The actual prompts shown to a user
 * are composed by the editor UI from this payload (see design-spec
 * `messaging/ai-copy.md`, `components/premium-ai-prompt`, and
 * `vocabulary/premium-trial-states.md`).
 */

/** Which engine produced the returned candidates. */
export type AnalysisEngine = DetectionEngine;

/**
 * What happened at the (optional) premium Vision stage. The two gating states
 * (`available` / `blocked`) are new in this grain: upload never auto-runs Vision
 * anymore, so an image-only PDF resolves to one of them until the user consents.
 *
 *  - `not-needed` — the heuristic engine was confident; Vision was never
 *                   considered. (Text PDF happy path.)
 *  - `available`  — the document read as scanned and the account MAY run the
 *                   premium engine (premium plan or free trials remaining), but it
 *                   has not run yet — the flow is waiting for the user to opt in.
 *                   No trial has been spent. (Persisted `AWAITING_CONSENT`.)
 *  - `blocked`    — the document read as scanned but the account may NOT run the
 *                   premium engine: every free trial is spent and the plan is not
 *                   premium. The upgrade path is offered instead
 *                   (`upgradeRequired`). (Persisted `BLOCKED`.)
 *  - `succeeded`  — Vision ran (after consent) and produced candidates.
 *  - `failed`     — Vision ran but could not produce a result (not configured /
 *                   timeout / transport / bad response). No candidates are
 *                   returned and `visionError` carries the structured reason.
 *
 * The wire values line up with what the frontend `parseAnalysisStatus` reads:
 * `visionStage !== 'not-needed'` ⇒ scanned document; `=== 'succeeded'` ⇒ the
 * premium engine already ran.
 */
export type VisionStage =
  | 'not-needed'
  | 'available'
  | 'blocked'
  | 'succeeded'
  | 'failed';

/**
 * The frontend-consumable status of one document analysis. Serializable and free
 * of PII / internal handles — safe to return straight to the client.
 */
export interface FieldAnalysisStatus {
  /** Which engine produced the returned candidates. */
  engine: AnalysisEngine;
  /** Final verdict of the engine that produced the candidates. */
  signal: DetectionSignal;
  /** Outcome of the premium Vision stage (see {@link VisionStage}). */
  visionStage: VisionStage;
  /** Structured failure reason, present only when `visionStage === 'failed'`. */
  visionError?: VisionErrorReason;
  /** The account is on a premium (unmetered) plan — free trials do not apply. */
  isPremium: boolean;
  /**
   * Free premium trials left on the account after this analysis. For a premium
   * account trials are irrelevant; the value still reports the (unclamped-by-plan)
   * balance and the UI hides the count for premium plans.
   */
  trialsRemaining: number;
  /**
   * The premium engine is needed but the account may not use it — every free
   * trial is spent and the plan is not premium. Drives the upgrade surface. True
   * exactly when `visionStage === 'blocked'`.
   */
  upgradeRequired: boolean;
  /**
   * The base (heuristic) engine already handled this text PDF — the premium engine
   * is **not** required — yet the account may *optionally* run it for higher
   * accuracy (premium plan or free trials remaining). Drives the non-coercive
   * accuracy-boost invite on text PDFs (design-spec `messaging/ai-copy.md` "정확도
   * 부스터 권유", `vocabulary/premium-trial-states.md` `표준-처리됨`+부스트 가능).
   *
   * Only ever true on the text-PDF happy path (`visionStage === 'not-needed'`); a
   * scanned document uses `visionStage`, and once premium has run the boost is
   * gone. The base auto-placement stays **unlimited and unmetered** regardless of
   * this flag — it never gates the standard engine, it only surfaces the optional
   * upsell-free premium invite.
   */
  boostAvailable: boolean;
}

/**
 * The orchestration's complete output for one document: the proposed fields plus
 * the status the frontend needs to render suggestions.
 */
export interface FieldAnalysisResult {
  /** Proposed input fields (possibly empty — e.g. an awaiting/blocked/failed run). */
  fields: FieldCandidate[];
  /** Engine / Vision-stage / trial status for the UI. */
  status: FieldAnalysisStatus;
}

export type { FieldCandidate };
