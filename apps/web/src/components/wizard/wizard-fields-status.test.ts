/**
 * Recommended/confirmed field state model (grain-3).
 *
 * Auto-place produces suggestions that must render as recommendations but stay
 * out of every save path and out of the "다음" gate until the user accepts them.
 * These tests pin that contract at the data layer: the candidate→draft mapping,
 * the accept/remove/bulk reducer actions, and the `confirmedFields` gate that
 * `canProceed` and the save functions share. The manual placement flow (fields
 * with no `status`) must behave exactly as before.
 */

import {
  wizardReducer,
  canProceed,
  currentStepKey,
  confirmedFields,
  isConfirmed,
  isRecommended,
  recommendedFieldsFromCandidates,
  initialWizardState,
  type WizardState,
  type SignFieldDraft,
} from './wizard-context';
import type { FieldCandidate } from '@/lib/field-anchors';
import type { DocumentSummary } from '@/lib/documents';

const doc = { id: 'doc_1', title: '근로계약서' } as unknown as DocumentSummary;

/** A confirmed (manually placed) field — no explicit status. */
function manual(id: string): SignFieldDraft {
  return { id, type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05 };
}

/** A recommended (auto-placed) field. */
function recommended(id: string): SignFieldDraft {
  return { id, type: 'DATE', page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.05, status: 'recommended' };
}

/** A wizard state parked on the 'fields' step with the given field set. */
function onFieldsStep(fields: SignFieldDraft[]): WizardState {
  // step 0 == 'upload', step 1 == 'fields' in the common sequence.
  return { ...initialWizardState, document: doc, step: 1, fields };
}

let ids = 0;
const makeId = () => `rec_${(ids += 1)}`;

const candidate: FieldCandidate = {
  type: 'SIGNATURE',
  page: 2,
  rect: { x: 0.3, y: 0.4, width: 0.25, height: 0.06 },
  anchorText: '서명',
  category: 'SIGN',
};

describe('field status predicates', () => {
  it('treats a field with no status as confirmed (manual/template flow unchanged)', () => {
    expect(isConfirmed(manual('f1'))).toBe(true);
    expect(isRecommended(manual('f1'))).toBe(false);
  });

  it('treats an explicit recommendation as not-confirmed', () => {
    expect(isConfirmed(recommended('r1'))).toBe(false);
    expect(isRecommended(recommended('r1'))).toBe(true);
  });

  it('confirmedFields keeps manual + accepted, drops recommendations', () => {
    const set = [manual('f1'), recommended('r1'), { ...manual('f2'), status: 'confirmed' as const }];
    expect(confirmedFields(set).map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});

describe('recommendedFieldsFromCandidates', () => {
  it('maps candidate geometry verbatim onto a recommended draft', () => {
    ids = 0;
    const [draft] = recommendedFieldsFromCandidates([candidate], makeId);
    expect(draft).toEqual({
      id: 'rec_1',
      type: 'SIGNATURE',
      page: 2,
      x: 0.3,
      y: 0.4,
      width: 0.25,
      height: 0.06,
      status: 'recommended',
    });
  });

  it('mints a fresh id per candidate and marks each recommended', () => {
    ids = 0;
    const drafts = recommendedFieldsFromCandidates([candidate, candidate], makeId);
    expect(drafts.map((d) => d.id)).toEqual(['rec_1', 'rec_2']);
    expect(drafts.every(isRecommended)).toBe(true);
  });

  it('returns [] for no candidates', () => {
    expect(recommendedFieldsFromCandidates([], makeId)).toEqual([]);
  });
});

describe('canProceed on the fields step', () => {
  it('stays locked when only recommendations exist', () => {
    const state = onFieldsStep([recommended('r1'), recommended('r2')]);
    expect(currentStepKey(state)).toBe('fields');
    expect(canProceed(state)).toBe(false);
  });

  it('unlocks once at least one field is confirmed', () => {
    expect(canProceed(onFieldsStep([manual('f1'), recommended('r1')]))).toBe(true);
  });

  it('stays locked with no fields at all', () => {
    expect(canProceed(onFieldsStep([]))).toBe(false);
  });
});

describe('recommendation reducer actions', () => {
  it('appends recommended drafts alongside existing fields', () => {
    const start = onFieldsStep([manual('f1')]);
    const next = wizardReducer(start, {
      type: 'ADD_RECOMMENDED_FIELDS',
      fields: [recommended('r1'), recommended('r2')],
    });
    expect(next.fields.map((f) => f.id)).toEqual(['f1', 'r1', 'r2']);
  });

  it('is a no-op for an empty recommendation batch (same reference)', () => {
    const start = onFieldsStep([manual('f1')]);
    expect(wizardReducer(start, { type: 'ADD_RECOMMENDED_FIELDS', fields: [] })).toBe(start);
  });

  it('ACCEPT_FIELD promotes one recommendation to confirmed', () => {
    const start = onFieldsStep([recommended('r1'), recommended('r2')]);
    const next = wizardReducer(start, { type: 'ACCEPT_FIELD', id: 'r1' });
    expect(next.fields.find((f) => f.id === 'r1')!.status).toBe('confirmed');
    expect(next.fields.find((f) => f.id === 'r2')!.status).toBe('recommended');
    // The accepted field now counts toward proceeding.
    expect(canProceed(next)).toBe(true);
  });

  it('ACCEPT_FIELD on a confirmed/unknown id is a no-op (same reference)', () => {
    const start = onFieldsStep([manual('f1'), recommended('r1')]);
    expect(wizardReducer(start, { type: 'ACCEPT_FIELD', id: 'f1' })).toBe(start);
    expect(wizardReducer(start, { type: 'ACCEPT_FIELD', id: 'nope' })).toBe(start);
  });

  it('ACCEPT_ALL_RECOMMENDED promotes every recommendation, leaving manual fields untouched', () => {
    const start = onFieldsStep([manual('f1'), recommended('r1'), recommended('r2')]);
    const next = wizardReducer(start, { type: 'ACCEPT_ALL_RECOMMENDED' });
    expect(next.fields.every(isConfirmed)).toBe(true);
    expect(confirmedFields(next.fields)).toHaveLength(3);
  });

  it('REMOVE_FIELD drops a single field by id', () => {
    const start = onFieldsStep([manual('f1'), recommended('r1')]);
    const next = wizardReducer(start, { type: 'REMOVE_FIELD', id: 'r1' });
    expect(next.fields.map((f) => f.id)).toEqual(['f1']);
  });

  it('REMOVE_FIELD with an unknown id is a no-op (same reference)', () => {
    const start = onFieldsStep([manual('f1')]);
    expect(wizardReducer(start, { type: 'REMOVE_FIELD', id: 'nope' })).toBe(start);
  });

  it('CLEAR_RECOMMENDED discards recommendations but keeps confirmed fields', () => {
    const start = onFieldsStep([manual('f1'), recommended('r1'), recommended('r2')]);
    const next = wizardReducer(start, { type: 'CLEAR_RECOMMENDED' });
    expect(next.fields.map((f) => f.id)).toEqual(['f1']);
  });

  it('CLEAR_RECOMMENDED with no recommendations is a no-op (same reference)', () => {
    const start = onFieldsStep([manual('f1')]);
    expect(wizardReducer(start, { type: 'CLEAR_RECOMMENDED' })).toBe(start);
  });
});
