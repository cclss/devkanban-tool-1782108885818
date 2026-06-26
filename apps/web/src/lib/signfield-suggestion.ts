/**
 * AI suggestion ↔ wizard-state glue (pure, DOM-free).
 *
 * grain-1/2 produce {@link SignFieldSuggestion}s; grain-4 has to (a) keep those
 * proposals in their own collection until the user confirms one, and (b) turn a
 * confirmed proposal into an ordinary, editable {@link SignFieldDraft}. The two
 * pure functions here are exactly that seam — kept out of the React modules so
 * they unit-test in the node jest env (same reason the engine + orchestration
 * already live in `lib/`).
 *
 *   • {@link suggestionToFieldDraft} — strip the AI-only metadata (confidence /
 *     source / anchorLabel) so an accepted suggestion becomes indistinguishable
 *     from a hand-placed field and flows through the existing normalize/save
 *     path unchanged. Geometry is re-clamped for the same in-page guarantee the
 *     manual drop path gives.
 *   • {@link deriveBannerState} — collapse the analysis lifecycle + the live
 *     suggestion count into the presentational SuggestionBanner's state (or
 *     `null` when there is nothing to announce), so the banner stays a dumb
 *     prop-driven primitive and the "hide once everything is applied/cleared"
 *     rule lives in one tested place.
 */

import { clampNormRect, type SignFieldType } from './field-geometry';
import type { SignFieldSuggestion } from './signfield-suggest';

/** The persisted/editable field shape (mirrors wizard-context's SignFieldDraft). */
export interface FieldDraftShape {
  id: string;
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex?: number;
}

/**
 * The AI analysis lifecycle as the wizard tracks it. `idle` = not started for
 * the current document; the three terminal states mirror {@link AnalysisResult}
 * but keep only what the UI needs (the suggestions themselves live beside this).
 */
export type AnalysisPhase =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | { status: 'done' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string };

/**
 * The presentational banner's state — structurally identical to the AI
 * package's `SuggestionBannerState`. Declared locally so this pure lib never
 * depends on a React component module; the object is structurally assignable
 * where the banner is rendered.
 */
export type BannerState =
  | { status: 'analyzing' }
  | { status: 'ready'; count: number }
  | { status: 'empty'; message?: string }
  | { status: 'error'; message?: string };

/**
 * Convert one accepted suggestion into a plain, editable field draft.
 *
 * Drops the AI-only metadata so the result is byte-for-byte a normal field, and
 * re-clamps the geometry (the engine already clamps, but doing it here keeps the
 * accept path identical to the manual drop path and defends against any
 * future/looser extractor). The caller supplies a fresh id so an accepted field
 * never collides with a later re-analysis's `ai-N` ids.
 */
export function suggestionToFieldDraft(
  suggestion: SignFieldSuggestion,
  id: string,
): FieldDraftShape {
  const norm = clampNormRect({
    x: suggestion.x,
    y: suggestion.y,
    width: suggestion.width,
    height: suggestion.height,
  });
  return { id, type: suggestion.type, page: suggestion.page, ...norm };
}

/**
 * Convert a batch of suggestions ("모두 적용"), assigning each a fresh id via
 * `makeId`. Order is preserved so the applied fields read in suggestion order.
 */
export function suggestionsToFieldDrafts(
  suggestions: readonly SignFieldSuggestion[],
  makeId: () => string,
): FieldDraftShape[] {
  return suggestions.map((s) => suggestionToFieldDraft(s, makeId()));
}

/**
 * Map the analysis phase + remaining suggestion count to the banner's state, or
 * `null` when the banner should not show at all.
 *
 * The key rule lives here: once a `done` run's suggestions are all applied or
 * cleared (`count === 0`), the banner disappears — the violet summary only ever
 * means "AI still has something pending for you".
 */
export function deriveBannerState(
  phase: AnalysisPhase,
  suggestionCount: number,
): BannerState | null {
  switch (phase.status) {
    case 'analyzing':
      return { status: 'analyzing' };
    case 'done':
      return suggestionCount > 0 ? { status: 'ready', count: suggestionCount } : null;
    case 'empty':
      return { status: 'empty', message: phase.message };
    case 'error':
      return { status: 'error', message: phase.message };
    case 'idle':
    default:
      return null;
  }
}
