/**
 * Premium AI trial invitation + upgrade path — the editor's brain for the
 * scanned-document flow (grain-7).
 *
 * The tiered analysis (grain-2~4) runs on upload and returns, alongside the field
 * candidates, a *status* describing whether the premium (Vision) engine is
 * relevant, whether it already ran, and how the free-trial / upgrade situation
 * stands. This module maps that structured status onto the three non-intrusive
 * surfaces the sender may see in the editor:
 *
 *   • invite  — a scanned document was detected and the sender can try the
 *               premium AI (free trials remaining, or on a premium plan). We ask
 *               for consent before spending a trial rather than burning one
 *               silently. (Story 2)
 *   • upgrade — the premium engine is needed but the sender has used every free
 *               trial and isn't on a premium plan; we offer the upgrade path plus
 *               an equal "place fields by hand" escape. (Story 4)
 *   • none    — nothing to prompt: a text PDF the heuristics handled, or the
 *               premium engine already ran (its remaining-count note is shown by
 *               the editor instead). (Stories 1 & 2-after-consent)
 *
 * Copy for every surface is reused from grain-5's central `AI_COPY.trial` /
 * `AI_COPY.upgrade` (design-spec `messaging/ai-copy.md`); this module only
 * decides *which* surface to show, never the words.
 *
 * Boundary (grain-7): frontend only. It reads the analysis status and, on
 * consent, re-requests the premium analysis through a seam. Billing / plan
 * changes are out of scope — the upgrade action just routes the sender to the
 * plan surface. Both network calls degrade to a neutral, no-prompt status so the
 * editor stays usable while the server pipeline is still dark (like grains 2–6).
 */

import { apiFetch } from './api';
import { parseSuggestions } from './ai-suggestions';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

/**
 * The editor-facing view of grain-4's `FieldAnalysisStatus`, reduced to exactly
 * the flags the trial/upgrade UX branches on. Internal engine terms (Vision /
 * heuristic / confidence) are intentionally dropped — the sender only ever sees
 * one "premium AI".
 */
export interface AnalysisStatus {
  /**
   * The background analysis is still running (the upload stamped the document
   * `analyzing` and no terminal stage has landed yet). While true, the editor
   * shows the calm "분석 중" notice and keeps polling; no premium prompt is shown.
   * Distinct from a terminal result with zero fields ("analyzed, found nothing").
   */
  analyzing: boolean;
  /**
   * The analysis reached a terminal *failure* (service hiccup / timeout) rather
   * than completing — no suggestions, but distinct from "found nothing". Drives
   * the "분석을 마치지 못했어요" fallback so the sender knows to retry or place by hand.
   */
  failed: boolean;
  /**
   * The document looks scanned / image-only, so the standard engine found
   * nothing and the premium engine is the way to auto-place fields. Derived from
   * the server telling us the premium stage was relevant at all.
   */
  scannedDocument: boolean;
  /** The account is on a premium (unmetered) plan. */
  premium: boolean;
  /** The premium engine already ran for this document and produced its result. */
  premiumUsed: boolean;
  /** Free premium trials left on the account after this analysis. */
  trialsRemaining: number;
  /**
   * The premium engine is needed but the account may not use it — every free
   * trial is spent and the plan isn't premium. Drives the upgrade surface.
   */
  upgradeRequired: boolean;
  /**
   * The base engine already handled this text PDF (nothing scanned) and the
   * account may *optionally* run the premium engine for a more accurate pass
   * (premium plan or free trials remaining). Drives the non-coercive accuracy
   * boost invite. The base auto-placement is unlimited, so this is a pure
   * opt-in — an exhausted non-premium account simply sees no prompt, never an
   * upgrade wall on a text PDF.
   */
  boostAvailable: boolean;
}

/** A text-PDF happy-path status: nothing scanned, nothing to prompt. */
export const NEUTRAL_STATUS: AnalysisStatus = {
  analyzing: false,
  failed: false,
  scannedDocument: false,
  premium: false,
  premiumUsed: false,
  trialsRemaining: 0,
  upgradeRequired: false,
  boostAvailable: false,
};

/**
 * Which non-intrusive premium surface the editor should show, if any.
 *   • invite  — scanned document, try the premium engine to place fields.
 *   • boost   — text PDF the base engine already handled; offer the premium
 *               engine as an *optional* accuracy boost (base stays unlimited).
 *   • upgrade — premium is needed but every free trial is spent (scanned only).
 */
export type PremiumPrompt = 'invite' | 'boost' | 'upgrade' | null;

/**
 * Whether the account can still run a premium pass on this document: on a premium
 * (unmetered) plan, or with free trials left, and it hasn't already run.
 */
function canRunPremium(status: AnalysisStatus): boolean {
  return !status.premiumUsed && (status.premium || status.trialsRemaining > 0);
}

/**
 * Decide the premium surface from an analysis status. Order matters:
 *   1. An exhausted account (`upgradeRequired`, scanned-only) always sees the
 *      upgrade path — never a "try it" invite it cannot accept.
 *   2. A scanned document the account can still run → the `invite` (Story 2).
 *   3. A text PDF the base engine handled, where the account can still run
 *      premium → the optional `boost` invite (accuracy booster). There is no
 *      upgrade wall on a text PDF: base placement is unlimited, so an exhausted
 *      non-premium account here simply gets no prompt.
 */
export function resolvePremiumPrompt(status: AnalysisStatus): PremiumPrompt {
  if (status.upgradeRequired) return 'upgrade';
  if (status.scannedDocument && canRunPremium(status)) return 'invite';
  if (status.boostAvailable && canRunPremium(status)) return 'boost';
  return null;
}

/**
 * Whether the editor should show the "N free trials remaining" note. Shown right
 * after a trial run (Story 2 tail) and on either invite — scanned (`invite`) or
 * the text-PDF accuracy boost (`boost`) — so the sender sees the cost before
 * consenting. Never for premium accounts, where trials don't apply.
 */
export function showsTrialCount(status: AnalysisStatus): boolean {
  return (
    !status.premium &&
    status.trialsRemaining >= 0 &&
    (status.premiumUsed || status.scannedDocument || status.boostAvailable)
  );
}

// --- wire mapping -----------------------------------------------------------

/** The premium-relevant slice of the server analysis status (grain-4). */
interface RawAnalysisStatus {
  visionStage?: unknown;
  isPremium?: unknown;
  trialsRemaining?: unknown;
  upgradeRequired?: unknown;
  boostAvailable?: unknown;
}

interface FieldAnalysisResponse {
  fields?: unknown;
  status?: RawAnalysisStatus;
}

/** The complete editor-facing analysis: adapted drafts + reduced status. */
export interface FieldAnalysis {
  drafts: SignFieldDraft[];
  status: AnalysisStatus;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Reduce the server status (untrusted) to the editor's {@link AnalysisStatus}.
 * `visionStage` is grain-4's `'not-needed' | 'blocked' | 'succeeded' | 'failed'`:
 * anything other than `not-needed` means the premium stage was relevant, i.e. the
 * document read as scanned; `succeeded` additionally means it already ran.
 */
export function parseAnalysisStatus(raw: RawAnalysisStatus | undefined): AnalysisStatus {
  if (!raw || typeof raw !== 'object') return NEUTRAL_STATUS;
  const stage = raw.visionStage;
  const analyzing = stage === 'analyzing';
  const failed = stage === 'failed';
  // `analyzing` (pending) and `failed` are lifecycle states, not a scanned-doc
  // signal — neither should surface a premium invite. Only the genuine premium
  // stages (`available` / `blocked` / `succeeded`) mark a scanned document.
  const scannedDocument =
    typeof stage === 'string' && stage !== 'not-needed' && !analyzing && !failed;
  return {
    analyzing,
    failed,
    scannedDocument,
    premium: asBool(raw.isPremium),
    premiumUsed: stage === 'succeeded',
    trialsRemaining: asCount(raw.trialsRemaining),
    upgradeRequired: asBool(raw.upgradeRequired),
    boostAvailable: asBool(raw.boostAvailable),
  };
}

function toAnalysis(res: FieldAnalysisResponse | null | undefined): FieldAnalysis {
  return {
    drafts: parseSuggestions(res?.fields),
    status: parseAnalysisStatus(res?.status),
  };
}

/** Neutral result used whenever a call can't complete (dark pipeline / errors). */
const EMPTY_ANALYSIS: FieldAnalysis = { drafts: [], status: NEUTRAL_STATUS };

/**
 * Fetch the initial analysis for a document: the AI-proposed fields plus the
 * trial/upgrade status. Never throws — a missing endpoint, auth lapse, transport
 * error, or malformed body all resolve to an empty, no-prompt result, so the
 * editor simply opens blank for manual placement.
 */
export async function fetchFieldAnalysis(
  documentId: string,
  token?: string,
): Promise<FieldAnalysis> {
  try {
    const res = await apiFetch<FieldAnalysisResponse>(
      `/documents/${encodeURIComponent(documentId)}/field-suggestions`,
      { token },
    );
    return toAnalysis(res);
  } catch {
    return EMPTY_ANALYSIS;
  }
}

/**
 * Re-request the analysis with the premium engine after the sender consents
 * (Story 2). Returns the freshly placed fields plus the updated status — the
 * trial count reflects the trial this run just spent. Never throws: on any
 * failure the editor keeps its current state and the sender can place by hand.
 */
export async function requestPremiumAnalysis(
  documentId: string,
  token?: string,
): Promise<FieldAnalysis> {
  try {
    const res = await apiFetch<FieldAnalysisResponse>(
      `/documents/${encodeURIComponent(documentId)}/premium-analysis`,
      { method: 'POST', token },
    );
    return toAnalysis(res);
  } catch {
    return EMPTY_ANALYSIS;
  }
}

// --- bounded polling --------------------------------------------------------

/**
 * Bounds for the editor's "wait for the background analysis" polling. Upload
 * stamps the document `analyzing`, so the first {@link fetchFieldAnalysis} may
 * come back still-pending; the editor re-fetches until a terminal stage lands.
 * Polling is strictly bounded so it can never spin forever or block manual use:
 * after {@link ANALYSIS_POLL.maxAttempts} re-fetches it gives up and falls back
 * to manual placement. The delay backs off linearly and caps, keeping early
 * checks snappy (the offline heuristic path finishes fast) without hammering the
 * API on a slow run.
 */
export const ANALYSIS_POLL = {
  /** Re-fetches after the initial request before giving up (~30s total). */
  maxAttempts: 12,
  /** First backoff, in ms. */
  baseMs: 1000,
  /** Backoff ceiling, in ms. */
  maxMs: 4000,
} as const;

/** Delay before the Nth re-fetch (1-based): linear backoff, capped. */
export function nextAnalysisPollDelay(attempt: number): number {
  const n = Math.max(1, Math.trunc(attempt));
  return Math.min(ANALYSIS_POLL.maxMs, ANALYSIS_POLL.baseMs * n);
}
