/**
 * Premium AI consent invitation — the editor's brain for the scanned-document and
 * text-PDF accuracy-boost flows.
 *
 * Premium AI auto-placement is unlimited on every plan (2026-07-06 decision), so
 * there is no trial count and no upgrade wall: the analysis just needs the
 * sender's consent for a scanned document (external call + PII). The tiered
 * analysis runs on upload and returns, alongside the field candidates, a *status*
 * describing whether the premium engine is relevant and whether it already ran.
 * This module maps that structured status onto the non-intrusive surfaces the
 * sender may see in the editor:
 *
 *   • invite  — a scanned document was detected; the sender consents and the AI
 *               finds fields for it. Unlimited — nothing is spent. (Story 2)
 *   • boost   — a text PDF the base engine already handled; offer the AI as an
 *               *optional* accuracy pass over the unlimited base placement.
 *   • none    — nothing to prompt: a text PDF the base handled with no boost, or
 *               the premium engine already ran. (Stories 1 & 2-after-consent)
 *
 * Copy for every surface is reused from the central `AI_COPY.trial` (design-spec
 * `messaging/ai-copy.md`); this module only decides *which* surface to show,
 * never the words.
 *
 * Boundary: frontend only. It reads the analysis status and, on consent,
 * re-requests the premium analysis through a seam. Both network calls degrade to
 * a neutral, no-prompt status so the editor stays usable while the server
 * pipeline is still dark.
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
  /** The premium engine already ran for this document and produced its result. */
  premiumUsed: boolean;
  /**
   * The base engine already handled this text PDF (nothing scanned) and the AI
   * can *optionally* run a more accurate pass. Drives the non-coercive accuracy
   * boost invite. The base auto-placement is unlimited, so this is a pure
   * opt-in — declining just keeps the base result.
   */
  boostAvailable: boolean;
}

/** A text-PDF happy-path status: nothing scanned, nothing to prompt. */
export const NEUTRAL_STATUS: AnalysisStatus = {
  analyzing: false,
  failed: false,
  scannedDocument: false,
  premiumUsed: false,
  boostAvailable: false,
};

/**
 * Which non-intrusive premium surface the editor should show, if any.
 *   • invite  — scanned document, consent to let the AI place fields (unlimited).
 *   • boost   — text PDF the base engine already handled; offer the AI as an
 *               *optional* accuracy boost (base stays unlimited).
 * There is no upgrade surface — premium AI is unlimited on every plan, so there
 * is nothing to gate (2026-07-06 decision).
 */
export type PremiumPrompt = 'invite' | 'boost' | null;

/**
 * Decide the premium surface from an analysis status. Premium is unlimited, so
 * the only gate is "has it already run": once it has, there is nothing to prompt.
 *   1. A scanned document not yet analyzed → the `invite` (consent step, Story 2).
 *   2. A text PDF the base engine handled with a boost available → the optional
 *      `boost` invite (accuracy booster over the unlimited base placement).
 */
export function resolvePremiumPrompt(status: AnalysisStatus): PremiumPrompt {
  if (status.premiumUsed) return null;
  if (status.scannedDocument) return 'invite';
  if (status.boostAvailable) return 'boost';
  return null;
}

// --- wire mapping -----------------------------------------------------------

/** The premium-relevant slice of the server analysis status. */
interface RawAnalysisStatus {
  visionStage?: unknown;
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

/**
 * Reduce the server status (untrusted) to the editor's {@link AnalysisStatus}.
 * `visionStage` is the server's `'not-needed' | 'available' | 'succeeded' |
 * 'analyzing' | 'failed'`: anything other than `not-needed` (and not a lifecycle
 * state) means the premium stage was relevant, i.e. the document read as scanned;
 * `succeeded` additionally means it already ran.
 */
export function parseAnalysisStatus(raw: RawAnalysisStatus | undefined): AnalysisStatus {
  if (!raw || typeof raw !== 'object') return NEUTRAL_STATUS;
  const stage = raw.visionStage;
  const analyzing = stage === 'analyzing';
  const failed = stage === 'failed';
  // `analyzing` (pending) and `failed` are lifecycle states, not a scanned-doc
  // signal — neither should surface a premium invite. Only the genuine premium
  // stages (`available` / `succeeded`) mark a scanned document.
  const scannedDocument =
    typeof stage === 'string' && stage !== 'not-needed' && !analyzing && !failed;
  return {
    analyzing,
    failed,
    scannedDocument,
    premiumUsed: stage === 'succeeded',
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
 * (Story 2). Returns the freshly placed fields plus the updated status. Premium
 * is unlimited, so consent spends nothing. Never throws: on any failure the
 * editor keeps its current state and the sender can place by hand.
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
