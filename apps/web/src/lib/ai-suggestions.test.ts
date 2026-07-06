/**
 * AI-suggestion adapter + editor-list helpers.
 *
 * These pin the frontend contract the editor rests on:
 *   • candidate → editor field mapping (source tag, fresh ids, in-page clamp),
 *   • the seed helper (keep manual, replace a prior AI batch, append),
 *   • the clear helper ("제안 모두 지우기" removes only AI fields),
 *   • the AI count that drives the "AI가 N개를 제안했어요" indicator.
 */

import {
  toAiFieldDrafts,
  withAiSuggestions,
  withoutAiSuggestions,
  countAiSuggestions,
  type AiFieldSuggestion,
} from './ai-suggestions';
import { MIN_NORM_WIDTH, MIN_NORM_HEIGHT } from './field-geometry';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

const candidate = (over: Partial<AiFieldSuggestion> = {}): AiFieldSuggestion => ({
  type: 'SIGNATURE',
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.26,
  height: 0.08,
  ...over,
});

const manual = (id: string): SignFieldDraft => ({
  id,
  type: 'TEXT',
  page: 1,
  x: 0.1,
  y: 0.1,
  width: 0.2,
  height: 0.05,
  source: 'manual',
});

describe('toAiFieldDrafts', () => {
  it('tags every draft as an AI suggestion and carries geometry through', () => {
    const draft = toAiFieldDrafts([candidate()])[0]!;
    expect(draft.source).toBe('ai');
    expect(draft.type).toBe('SIGNATURE');
    expect(draft.page).toBe(1);
    expect(draft).toMatchObject({ x: 0.1, y: 0.2, width: 0.26, height: 0.08 });
  });

  it('assigns a distinct id to each suggestion', () => {
    const drafts = toAiFieldDrafts([candidate(), candidate(), candidate()]);
    const ids = new Set(drafts.map((d) => d.id));
    expect(ids.size).toBe(3);
  });

  it('clamps an out-of-page candidate to a valid in-page box', () => {
    const draft = toAiFieldDrafts([
      candidate({ x: 0.98, y: 1.4, width: 0.5, height: 0.001 }),
    ])[0]!;
    expect(draft.height).toBeGreaterThanOrEqual(MIN_NORM_HEIGHT);
    expect(draft.width).toBeGreaterThanOrEqual(MIN_NORM_WIDTH);
    expect(draft.x).toBeGreaterThanOrEqual(0);
    expect(draft.x + draft.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(draft.y).toBeGreaterThanOrEqual(0);
    expect(draft.y + draft.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('maps an empty candidate list to an empty draft list', () => {
    expect(toAiFieldDrafts([])).toEqual([]);
  });
});

describe('withAiSuggestions', () => {
  it('keeps manual fields and appends the AI batch', () => {
    const ai = toAiFieldDrafts([candidate()]);
    const next = withAiSuggestions([manual('m1')], ai);
    expect(next).toHaveLength(2);
    expect(next[0]?.source).toBe('manual');
    expect(next[1]?.source).toBe('ai');
  });

  it('replaces a prior AI batch instead of duplicating it', () => {
    const first = toAiFieldDrafts([candidate(), candidate()]);
    const seeded = withAiSuggestions([manual('m1')], first);
    const second = toAiFieldDrafts([candidate()]);
    const reseeded = withAiSuggestions(seeded, second);
    expect(countAiSuggestions(reseeded)).toBe(1);
    expect(reseeded.filter((f) => f.source === 'manual')).toHaveLength(1);
  });
});

describe('withoutAiSuggestions', () => {
  it('removes only AI fields, leaving manual ones (Clear All Suggestions)', () => {
    const seeded = withAiSuggestions([manual('m1')], toAiFieldDrafts([candidate(), candidate()]));
    const cleared = withoutAiSuggestions(seeded);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.id).toBe('m1');
    expect(countAiSuggestions(cleared)).toBe(0);
  });

  it('is a no-op when there are no AI fields', () => {
    const only = [manual('m1'), manual('m2')];
    expect(withoutAiSuggestions(only)).toHaveLength(2);
  });
});

describe('countAiSuggestions', () => {
  it('counts only AI-origin fields', () => {
    const fields = withAiSuggestions([manual('m1')], toAiFieldDrafts([candidate(), candidate()]));
    expect(countAiSuggestions(fields)).toBe(2);
  });
});
