/**
 * Pure tests for the candidate→draft adapter.
 *
 * The orchestration half (`autoPlaceFields`) is pdfjs I/O and covered by the
 * pure modules it composes; here we pin {@link candidatesToSuggestions}:
 *   • shape — a candidate's `NormRect` spreads into `x`/`y`/`width`/`height`,
 *     with no `id` and no `recipientIndex`,
 *   • dedup — a candidate is dropped only when an existing confirmed field
 *     shares its page and type AND sits on the same spot; a different page,
 *     different type, or a far-away box of the same type all keep it.
 */

import { candidatesToSuggestions, type FieldSuggestion } from './field-candidates';
import type { FieldCandidate } from './field-anchors';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

function candidate(
  over: Partial<FieldCandidate> & Pick<FieldCandidate, 'type' | 'page'>,
): FieldCandidate {
  return {
    kind: 'signature',
    anchorText: '서명',
    rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 },
    ...over,
  };
}

function field(over: Partial<SignFieldDraft> & Pick<SignFieldDraft, 'type' | 'page'>): SignFieldDraft {
  return {
    id: 'f1',
    x: 0.1,
    y: 0.1,
    width: 0.26,
    height: 0.08,
    ...over,
  };
}

describe('candidatesToSuggestions — shape', () => {
  it('spreads the rect and omits id / recipientIndex', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 2, rect: { x: 0.2, y: 0.3, width: 0.26, height: 0.08 } }),
    ];
    const [s] = candidatesToSuggestions(cands, []);
    expect(s).toEqual<FieldSuggestion>({
      type: 'SIGNATURE',
      page: 2,
      x: 0.2,
      y: 0.3,
      width: 0.26,
      height: 0.08,
    });
    expect('id' in s!).toBe(false);
    expect('recipientIndex' in s!).toBe(false);
  });

  it('preserves order and passes every candidate through when there are no existing fields', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 1 }),
      candidate({ type: 'DATE', page: 1, rect: { x: 0.5, y: 0.5, width: 0.18, height: 0.05 } }),
      candidate({ type: 'TEXT', page: 2, rect: { x: 0.1, y: 0.9, width: 0.28, height: 0.06 } }),
    ];
    const out = candidatesToSuggestions(cands, []);
    expect(out.map((s) => [s.type, s.page])).toEqual([
      ['SIGNATURE', 1],
      ['DATE', 1],
      ['TEXT', 2],
    ]);
  });
});

describe('candidatesToSuggestions — dedup', () => {
  it('drops a candidate that overlaps an existing field of the same page and type', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 } })];
    const existing = [field({ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.26, height: 0.08 })];
    expect(candidatesToSuggestions(cands, existing)).toEqual([]);
  });

  it('keeps a candidate when the existing field is on a different page', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1 })];
    const existing = [field({ type: 'SIGNATURE', page: 2 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('keeps a candidate when the existing field is a different type at the same spot', () => {
    const cands = [candidate({ type: 'SIGNATURE', page: 1 })];
    const existing = [field({ type: 'DATE', page: 1 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('keeps a same-type candidate that sits far from the existing field', () => {
    const cands = [candidate({ type: 'TEXT', page: 1, rect: { x: 0.1, y: 0.1, width: 0.28, height: 0.06 } })];
    const existing = [field({ type: 'TEXT', page: 1, x: 0.6, y: 0.7, width: 0.28, height: 0.06 })];
    expect(candidatesToSuggestions(cands, existing)).toHaveLength(1);
  });

  it('treats a small offset within proximity as a duplicate', () => {
    const cands = [candidate({ type: 'DATE', page: 3, rect: { x: 0.30, y: 0.40, width: 0.18, height: 0.05 } })];
    // existing centered ~0.02 away on each axis — inside DEDUP_PROXIMITY (0.05)
    const existing = [field({ type: 'DATE', page: 3, x: 0.32, y: 0.42, width: 0.18, height: 0.05 })];
    expect(candidatesToSuggestions(cands, existing)).toEqual([]);
  });

  it('drops only the colliding candidate, keeping others', () => {
    const cands = [
      candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.1, y: 0.1, width: 0.26, height: 0.08 } }),
      candidate({ type: 'SIGNATURE', page: 1, rect: { x: 0.6, y: 0.8, width: 0.26, height: 0.08 } }),
    ];
    const existing = [field({ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.26, height: 0.08 })];
    const out = candidatesToSuggestions(cands, existing);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo(0.6, 5);
  });
});
