/**
 * Integration: 제안 → 확인/조정 → 확정(저장) → 발송 준비 (grain-2~4 contract).
 *
 * Walks the *frontend* half of the confirm pipeline through the real pure libs,
 * end to end, asserting the provenance + send-readiness contract holds across the
 * whole chain rather than per unit:
 *
 *   1. AI proposes fields  → `SignFieldSuggestion`s, banner shows `ready(count)`.
 *   2. The sender confirms → `suggestionToFieldDraft` turns each accepted proposal
 *      into an editable field, *preserving* its `source:'ai'` + confidence; the
 *      accepted suggestion leaves the pending set (mirrors the wizard reducer's
 *      ACCEPT_SUGGESTION). Once nothing is pending the banner collapses (`null`).
 *   3. The sender may adjust geometry  → the box is re-clamped in-page; the edit
 *      carries the field's recorded provenance forward unchanged (the current
 *      pipeline sets provenance at placement/accept time, not on every nudge).
 *   4. Saving confirms  → `saveFields` maps each field to its persisted payload
 *      (`'ai'`→`'AI'` + confidence; hand-placed/adjusted → `'MANUAL'`, no
 *      confidence) and the server flips the document to 발송 준비 완료 (READY).
 *
 * The wizard reducer + React surfaces live in `.tsx` modules the node-env jest
 * transform doesn't compile, so the reducer's trivial append/remove is modelled
 * inline here; everything with real logic (`suggestionToFieldDraft`,
 * `deriveBannerState`, the geometry clamp, `saveFields`) is the production code.
 * The server contract this leans on is unit-tested in
 * `apps/api/.../documents.confirm-pipeline.spec.ts`; here a stub stands in for it
 * but faithfully reproduces the save→READY rule.
 */

import {
  suggestionToFieldDraft,
  suggestionsToFieldDrafts,
  deriveBannerState,
} from './signfield-suggestion';
import { clampNormRect, scaleNormRectAroundCenter } from './field-geometry';
import { saveFields } from './send';
import type { SignFieldSuggestion } from './signfield-suggest';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

// --- server stub: reproduces the real save→READY rule (unit-tested API-side) --
const apiFetch = jest.fn();
jest.mock('./api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_path: string, opts: { json: { fields: unknown[] } }) => {
    const ready = opts.json.fields.length > 0;
    return {
      count: opts.json.fields.length,
      status: ready ? 'READY' : 'DRAFT',
      statusLabel: ready ? '발송 준비 완료' : '작성 중',
      readyToSend: ready,
    };
  });
});

function suggestion(over: Partial<SignFieldSuggestion> = {}): SignFieldSuggestion {
  return {
    id: 'ai-1',
    type: 'SIGNATURE',
    page: 1,
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

/** The wizard's ACCEPT_SUGGESTION, modelled inline (reducer lives in a .tsx). */
function accept(
  fields: SignFieldDraft[],
  suggestions: SignFieldSuggestion[],
  id: string,
  newId: string,
): { fields: SignFieldDraft[]; suggestions: SignFieldSuggestion[] } {
  const s = suggestions.find((x) => x.id === id)!;
  return {
    fields: [...fields, suggestionToFieldDraft(s, newId) as SignFieldDraft],
    suggestions: suggestions.filter((x) => x.id !== id),
  };
}

describe('confirm pipeline — accept-all → save → 발송 준비', () => {
  it('proposes, confirms every suggestion as-is, and saves to READY with AI provenance', async () => {
    // 1. AI proposed two fields; the banner announces them.
    const proposed = [
      suggestion({ id: 'ai-1', type: 'SIGNATURE', confidence: 0.92 }),
      suggestion({ id: 'ai-2', type: 'DATE', page: 2, confidence: 0.71 }),
    ];
    expect(deriveBannerState({ status: 'done' }, proposed.length)).toEqual({
      status: 'ready',
      count: 2,
    });

    // 2. "모두 적용" — every suggestion becomes a field, provenance preserved.
    let id = 0;
    const fields = suggestionsToFieldDrafts(proposed, () => `f-${(id += 1)}`) as SignFieldDraft[];
    const pending: SignFieldSuggestion[] = [];
    expect(fields.map((f) => f.source)).toEqual(['ai', 'ai']);
    expect(fields.map((f) => f.confidence)).toEqual([0.92, 0.71]);
    // Nothing pending → the violet banner disappears.
    expect(deriveBannerState({ status: 'done' }, pending.length)).toBeNull();

    // 3 + 4. Confirm = save. Server flips the document to 발송 준비 완료.
    const result = await saveFields('doc-1', fields);
    const body = apiFetch.mock.calls[0][1].json as { fields: Array<Record<string, unknown>> };
    expect(body.fields).toEqual([
      { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.26, height: 0.08, recipientIndex: 0, source: 'AI', confidence: 0.92 },
      { type: 'DATE', page: 2, x: 0.1, y: 0.2, width: 0.26, height: 0.08, recipientIndex: 0, source: 'AI', confidence: 0.71 },
    ]);
    expect(result).toMatchObject({ status: 'READY', readyToSend: true, count: 2 });
  });
});

describe('confirm pipeline — accept one, add one by hand (mixed provenance)', () => {
  it('records the accepted proposal as AI-as-is and the hand-placed field as MANUAL', async () => {
    const proposed = [suggestion({ id: 'ai-1', confidence: 0.88 })];

    // Confirm the single proposal → an 'ai' field; the pending set empties.
    const step = accept([], proposed, 'ai-1', 'f-ai');
    expect(step.suggestions).toHaveLength(0);
    expect(step.fields[0]).toMatchObject({ source: 'ai', confidence: 0.88 });

    // The sender also drops a field by hand (no provenance → manual on save).
    const handPlaced: SignFieldDraft = {
      id: 'f-manual',
      type: 'TEXT',
      page: 1,
      x: 0.5,
      y: 0.5,
      width: 0.28,
      height: 0.06,
    };
    const fields = [...step.fields, handPlaced];

    await saveFields('doc-1', fields);
    const body = apiFetch.mock.calls[0][1].json as { fields: Array<Record<string, unknown>> };
    expect(body.fields[0]).toMatchObject({ source: 'AI', confidence: 0.88 });
    expect(body.fields[1]!.source).toBe('MANUAL');
    expect(body.fields[1]).not.toHaveProperty('confidence');
  });
});

describe('confirm pipeline — adjust before confirming', () => {
  it('keeps an adjusted field in-page and carries its provenance into the save payload', async () => {
    // Accept a proposal sitting near the page edge…
    const step = accept([], [suggestion({ id: 'ai-1', x: 0.9, y: 0.05, confidence: 0.8 })], 'ai-1', 'f-1');
    const accepted = step.fields[0]!;

    // …then grow it (size stepper) past the right/bottom edge. The shared clamp
    // (exactly what the touch + desktop edit paths apply) pulls it back in-page.
    const adjusted: SignFieldDraft = {
      ...accepted,
      ...clampNormRect(scaleNormRectAroundCenter(accepted, 1.5)),
    };
    expect(adjusted.x).toBeGreaterThanOrEqual(0);
    expect(adjusted.y).toBeGreaterThanOrEqual(0);
    expect(adjusted.x + adjusted.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(adjusted.y + adjusted.height).toBeLessThanOrEqual(1 + 1e-9);

    const result = await saveFields('doc-1', [adjusted]);
    const body = apiFetch.mock.calls[0][1].json as { fields: Array<Record<string, unknown>> };
    // Geometry edit doesn't itself rewrite provenance; the accepted field is
    // still recorded as 'ai', and every coordinate stays server-valid (0..1).
    expect(body.fields[0]).toMatchObject({ source: 'AI', confidence: 0.8 });
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      expect(body.fields[0]![k] as number).toBeGreaterThanOrEqual(0);
      expect(body.fields[0]![k] as number).toBeLessThanOrEqual(1);
    }
    expect(result.readyToSend).toBe(true);
  });
});

describe('confirm pipeline — nothing confirmed stays a draft', () => {
  it('saving with no confirmed fields leaves the document not ready to send', async () => {
    const result = await saveFields('doc-1', []);
    const body = apiFetch.mock.calls[0][1].json as { fields: unknown[] };
    expect(body.fields).toEqual([]);
    expect(result).toMatchObject({ status: 'DRAFT', readyToSend: false, count: 0 });
  });
});
