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
}

/** A text-PDF happy-path status: nothing scanned, nothing to prompt. */
export const NEUTRAL_STATUS: AnalysisStatus = {
  scannedDocument: false,
  premium: false,
  premiumUsed: false,
  trialsRemaining: 0,
  upgradeRequired: false,
};

/** Which non-intrusive premium surface the editor should show, if any. */
export type PremiumPrompt = 'invite' | 'upgrade' | null;

/**
 * Decide the premium surface from an analysis status. Order matters: an exhausted
 * account (`upgradeRequired`) always sees the upgrade path, even though the
 * document is also "scanned"; the invite is only for accounts that can still try
 * the premium engine and haven't yet.
 */
export function resolvePremiumPrompt(status: AnalysisStatus): PremiumPrompt {
  if (status.upgradeRequired) return 'upgrade';
  if (status.scannedDocument && !status.premiumUsed && (status.premium || status.trialsRemaining > 0)) {
    return 'invite';
  }
  return null;
}

/**
 * Whether the editor should show the "N free trials remaining" note. Shown right
 * after a trial run (Story 2 tail) and on the invite (so the sender sees the cost
 * before consenting) — never for premium accounts, where trials don't apply.
 */
export function showsTrialCount(status: AnalysisStatus): boolean {
  return !status.premium && status.trialsRemaining >= 0 && (status.premiumUsed || status.scannedDocument);
}

// --- wire mapping -----------------------------------------------------------

/** The premium-relevant slice of the server analysis status (grain-4). */
interface RawAnalysisStatus {
  visionStage?: unknown;
  isPremium?: unknown;
  trialsRemaining?: unknown;
  upgradeRequired?: unknown;
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
  const scannedDocument = typeof stage === 'string' && stage !== 'not-needed';
  return {
    scannedDocument,
    premium: asBool(raw.isPremium),
    premiumUsed: stage === 'succeeded',
    trialsRemaining: asCount(raw.trialsRemaining),
    upgradeRequired: asBool(raw.upgradeRequired),
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
