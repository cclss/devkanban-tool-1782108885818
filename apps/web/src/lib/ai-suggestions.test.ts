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
  parseSuggestions,
  toAiFieldDrafts,
  withAiSuggestions,
  withoutAiSuggestions,
  countAiSuggestions,
  type AiFieldSuggestion,
} from './ai-suggestions';
import { MIN_NORM_WIDTH, MIN_NORM_HEIGHT } from './field-geometry';
import { AI_COPY } from './ai-copy';
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

// AI output is untrusted wire input. A malformed candidate must be *dropped*,
// never adapted into a broken box on the canvas — the editor should open with
// only the valid suggestions (or blank) rather than a field with NaN/absent
// geometry. This pins the ingress boundary the reducer's SEED action rests on.
describe('parseSuggestions (untrusted wire → editor drafts)', () => {
  it('adapts valid wire candidates into ai-source drafts', () => {
    const drafts = parseSuggestions([candidate(), candidate({ type: 'DATE' })]);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.source === 'ai')).toBe(true);
    expect(drafts.map((d) => d.type)).toEqual(['SIGNATURE', 'DATE']);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(2);
  });

  it('drops candidates with non-finite geometry instead of making a broken box', () => {
    const drafts = parseSuggestions([
      candidate(), // valid
      candidate({ width: Number.NaN }), // broken
      candidate({ x: Number.POSITIVE_INFINITY }), // broken
      candidate({ height: 'big' as unknown as number }), // wrong type
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.source).toBe('ai');
  });

  it('drops candidates with an unknown field type', () => {
    const drafts = parseSuggestions([
      candidate(),
      candidate({ type: 'CHECKBOX' as unknown as AiFieldSuggestion['type'] }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.type).toBe('SIGNATURE');
  });

  it('collapses a missing / malformed list to an empty batch (blank canvas)', () => {
    expect(parseSuggestions(undefined)).toEqual([]);
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions({ not: 'an array' })).toEqual([]);
    expect(parseSuggestions([null, 42, 'x', {}])).toEqual([]);
  });
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

// grain-5 — the editor treats an AI suggestion as a first-class, fully-editable
// field: the sender can move / resize / delete it like a manual one, yet it keeps
// its `ai` origin so "제안 모두 지우기" still targets it (suggested-field-marker/base).
describe('editing an AI suggestion', () => {
  it('keeps the ai origin after a move/resize, so it stays a clear-all target', () => {
    const seeded = toAiFieldDrafts([candidate()])[0]!;
    // The canvas edits geometry in place (same id, new box) — origin is untouched.
    const nudged: SignFieldDraft = { ...seeded, x: 0.55, y: 0.6, width: 0.3, height: 0.12 };
    expect(nudged.source).toBe('ai');
    expect(countAiSuggestions([nudged])).toBe(1);
    // "제안 모두 지우기" removes it even after the user moved it around.
    expect(withoutAiSuggestions([nudged])).toHaveLength(0);
  });

  it('deleting one suggestion leaves the rest of the batch intact', () => {
    const [a, b, c] = toAiFieldDrafts([candidate(), candidate(), candidate()]);
    const afterDelete = [a!, c!]; // sender deleted the middle suggestion
    expect(countAiSuggestions(afterDelete)).toBe(2);
    expect(afterDelete.map((f) => f.id)).not.toContain(b!.id);
  });
});

// grain-5 — the AI suggestion count drives the editor's guidance banner, and the
// "found nothing" vs "could not finish" states stay distinct (messaging/ai-copy.md).
describe('AI guidance / failure copy shown in the editor', () => {
  it('the live AI count feeds the "N개 제안" banner', () => {
    const fields = withAiSuggestions([manual('m1')], toAiFieldDrafts([candidate(), candidate()]));
    const banner = AI_COPY.suggestion.placed(countAiSuggestions(fields));
    expect(banner).toContain('2개');
    expect(banner).toContain('바꿀 수 있어요'); // hands control back to the sender
  });

  it('"clear all" is labelled for the reset action', () => {
    expect(AI_COPY.suggestion.clearAll).toBe('제안 모두 지우기');
  });

  it('"found nothing" and "could not finish" are separate, next-action guidance', () => {
    // Empty result (analysis succeeded, no fields) vs a failed/interrupted run.
    expect(AI_COPY.suggestion.none).not.toBe(AI_COPY.analysis.failed);
    expect(AI_COPY.suggestion.none).toContain('직접 배치');
    expect(AI_COPY.analysis.failed).toContain('다시 시도');
    expect(AI_COPY.analysis.failed).toContain('직접 배치');
  });
});
