/**
 * Wizard reducer — AI-suggestion state transitions.
 *
 * The adapter/helper contract is pinned in `lib/ai-suggestions.test.ts`; this
 * file pins the *reducer* layer the editor dispatches against, so the three
 * invariants the feature promises hold at the action boundary:
 *
 *   • SEED preserves the sender's manual fields (manual-field-preserve),
 *   • re-SEED replaces a prior AI batch without duplicating it (reseed-no-dup),
 *   • CLEAR removes every suggestion, leaving only manual fields (clear-all),
 *
 * and that an AI field keeps its `ai` origin after the user moves/resizes it, so
 * "제안 모두 지우기" still targets it. Imported as a pure function — no render.
 */

import {
  wizardReducer,
  initialWizardState,
  type SignFieldDraft,
  type WizardState,
} from './wizard-context';
import { parseSuggestions } from '@/lib/ai-suggestions';

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

const wireCandidate = (over: Record<string, unknown> = {}) => ({
  type: 'SIGNATURE',
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.26,
  height: 0.08,
  ...over,
});

const stateWith = (fields: SignFieldDraft[]): WizardState => ({
  ...initialWizardState,
  fields,
});

describe('SEED_AI_SUGGESTIONS', () => {
  it('drops the AI batch onto an empty canvas', () => {
    const batch = parseSuggestions([wireCandidate(), wireCandidate()]);
    const next = wizardReducer(stateWith([]), { type: 'SEED_AI_SUGGESTIONS', fields: batch });
    expect(next.fields).toHaveLength(2);
    expect(next.fields.every((f) => f.source === 'ai')).toBe(true);
  });

  it('preserves the sender’s manual fields when seeding', () => {
    const batch = parseSuggestions([wireCandidate()]);
    const next = wizardReducer(stateWith([manual('m1'), manual('m2')]), {
      type: 'SEED_AI_SUGGESTIONS',
      fields: batch,
    });
    expect(next.fields.filter((f) => f.source === 'manual').map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(next.fields.filter((f) => f.source === 'ai')).toHaveLength(1);
  });

  it('replaces a prior AI batch on re-seed without duplicating (reseed-no-dup)', () => {
    const first = wizardReducer(stateWith([manual('m1')]), {
      type: 'SEED_AI_SUGGESTIONS',
      fields: parseSuggestions([wireCandidate(), wireCandidate(), wireCandidate()]),
    });
    const reseeded = wizardReducer(first, {
      type: 'SEED_AI_SUGGESTIONS',
      fields: parseSuggestions([wireCandidate()]),
    });
    expect(reseeded.fields.filter((f) => f.source === 'ai')).toHaveLength(1);
    expect(reseeded.fields.filter((f) => f.source === 'manual').map((f) => f.id)).toEqual(['m1']);
  });

  it('does not mutate the previous state', () => {
    const prev = stateWith([manual('m1')]);
    wizardReducer(prev, { type: 'SEED_AI_SUGGESTIONS', fields: parseSuggestions([wireCandidate()]) });
    expect(prev.fields).toHaveLength(1);
  });
});

describe('CLEAR_AI_SUGGESTIONS', () => {
  it('removes every AI suggestion, leaving only manual fields (clear-all)', () => {
    const seeded = wizardReducer(stateWith([manual('m1'), manual('m2')]), {
      type: 'SEED_AI_SUGGESTIONS',
      fields: parseSuggestions([wireCandidate(), wireCandidate()]),
    });
    const cleared = wizardReducer(seeded, { type: 'CLEAR_AI_SUGGESTIONS' });
    expect(cleared.fields.map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(cleared.fields.every((f) => f.source === 'manual')).toBe(true);
  });

  it('leaves a blank slate when the canvas held only suggestions', () => {
    const seeded = wizardReducer(stateWith([]), {
      type: 'SEED_AI_SUGGESTIONS',
      fields: parseSuggestions([wireCandidate(), wireCandidate()]),
    });
    const cleared = wizardReducer(seeded, { type: 'CLEAR_AI_SUGGESTIONS' });
    expect(cleared.fields).toEqual([]);
  });
});

describe('AI origin survives editing', () => {
  it('an AI field moved/resized via SET_FIELDS is still cleared by CLEAR_AI_SUGGESTIONS', () => {
    const seeded = wizardReducer(stateWith([manual('m1')]), {
      type: 'SEED_AI_SUGGESTIONS',
      fields: parseSuggestions([wireCandidate()]),
    });
    const aiField = seeded.fields.find((f) => f.source === 'ai')!;
    // The canvas edits geometry in place (same id, new box) — origin is untouched.
    const moved = seeded.fields.map((f) =>
      f.id === aiField.id ? { ...f, x: 0.55, y: 0.6, width: 0.3, height: 0.12 } : f,
    );
    const edited = wizardReducer(seeded, { type: 'SET_FIELDS', fields: moved });
    expect(edited.fields.find((f) => f.id === aiField.id)?.source).toBe('ai');

    const cleared = wizardReducer(edited, { type: 'CLEAR_AI_SUGGESTIONS' });
    expect(cleared.fields.map((f) => f.id)).toEqual(['m1']);
  });
});
