/**
 * Tests for the AI-suggestion ↔ wizard-state glue.
 *
 *   • suggestionToFieldDraft / suggestionsToFieldDrafts — an accepted suggestion
 *     becomes an editable field: provenance (source/confidence) preserved, the
 *     UI-only anchorLabel dropped, geometry preserved + clamped, fresh id applied.
 *   • deriveBannerState — the analysis lifecycle + live count maps to the
 *     banner's state, and collapses to `null` once nothing is pending.
 */

import {
  suggestionToFieldDraft,
  suggestionsToFieldDrafts,
  deriveBannerState,
  type AnalysisPhase,
} from './signfield-suggestion';
import { MIN_NORM_WIDTH, MIN_NORM_HEIGHT } from './field-geometry';
import type { SignFieldSuggestion } from './signfield-suggest';

function suggestion(over: Partial<SignFieldSuggestion> = {}): SignFieldSuggestion {
  return {
    id: 'ai-1',
    type: 'SIGNATURE',
    page: 2,
    x: 0.1,
    y: 0.2,
    width: 0.26,
    height: 0.08,
    confidence: 0.9,
    source: 'ai',
    anchorLabel: '서명',
    ...over,
  };
}

describe('suggestionToFieldDraft', () => {
  it('keeps type/page/geometry + provenance and applies the supplied id', () => {
    const draft = suggestionToFieldDraft(suggestion(), 'field-9');
    expect(draft).toEqual({
      id: 'field-9',
      type: 'SIGNATURE',
      page: 2,
      x: 0.1,
      y: 0.2,
      width: 0.26,
      height: 0.08,
      source: 'ai',
      confidence: 0.9,
    });
  });

  it('preserves AI provenance (source/confidence) but drops the UI-only anchorLabel', () => {
    const draft = suggestionToFieldDraft(suggestion(), 'field-1') as unknown as Record<
      string,
      unknown
    >;
    expect(draft.source).toBe('ai');
    expect(draft.confidence).toBe(0.9);
    expect(draft).not.toHaveProperty('anchorLabel');
  });

  it('clamps out-of-page / sub-minimum geometry like the manual drop path', () => {
    const draft = suggestionToFieldDraft(
      suggestion({ x: 0.99, y: -0.5, width: 0.001, height: 0.001 }),
      'field-2',
    );
    expect(draft.width).toBeGreaterThanOrEqual(MIN_NORM_WIDTH);
    expect(draft.height).toBeGreaterThanOrEqual(MIN_NORM_HEIGHT);
    expect(draft.x + draft.width).toBeLessThanOrEqual(1);
    expect(draft.y).toBeGreaterThanOrEqual(0);
  });
});

describe('suggestionsToFieldDrafts', () => {
  it('preserves order and assigns a fresh id per field', () => {
    let n = 0;
    const drafts = suggestionsToFieldDrafts(
      [suggestion({ id: 'ai-1', type: 'SIGNATURE' }), suggestion({ id: 'ai-2', type: 'DATE' })],
      () => `new-${(n += 1)}`,
    );
    expect(drafts.map((d) => d.id)).toEqual(['new-1', 'new-2']);
    expect(drafts.map((d) => d.type)).toEqual(['SIGNATURE', 'DATE']);
  });

  it('returns an empty list for no suggestions', () => {
    expect(suggestionsToFieldDrafts([], () => 'x')).toEqual([]);
  });
});

describe('deriveBannerState', () => {
  it('shows the analyzing state regardless of count', () => {
    expect(deriveBannerState({ status: 'analyzing' }, 0)).toEqual({ status: 'analyzing' });
  });

  it('shows ready(count) when a done run still has suggestions', () => {
    expect(deriveBannerState({ status: 'done' }, 3)).toEqual({ status: 'ready', count: 3 });
  });

  it('hides (null) once a done run has no suggestions left', () => {
    expect(deriveBannerState({ status: 'done' }, 0)).toBeNull();
  });

  it('passes through empty/error copy', () => {
    const empty: AnalysisPhase = { status: 'empty', message: '없어요' };
    const error: AnalysisPhase = { status: 'error', message: '실패' };
    expect(deriveBannerState(empty, 0)).toEqual({ status: 'empty', message: '없어요' });
    expect(deriveBannerState(error, 0)).toEqual({ status: 'error', message: '실패' });
  });

  it('is hidden while idle', () => {
    expect(deriveBannerState({ status: 'idle' }, 0)).toBeNull();
  });
});
