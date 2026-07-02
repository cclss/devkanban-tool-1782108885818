/**
 * State-layer contract: auto-placed (AI) fields are indistinguishable from
 * manually placed ones.
 *
 * The feature promise is that AI-suggested fields can be moved, resized, and
 * deleted exactly like hand-placed fields. That promise lives entirely in the
 * reducer's shape decisions — there is no `origin`/`source` marker, edits and
 * deletes flow through the same `SET_FIELDS`, and a one-shot guard keeps a
 * re-entry or a late/duplicate analysis response from ever clobbering those
 * edits. These tests lock that existing behavior so a future change can't
 * quietly reintroduce a provenance split.
 */

import {
  wizardReducer,
  initialWizardState,
  type WizardState,
  type SignFieldDraft,
} from './wizard-context';
import type { DocumentSummary } from '@/lib/documents';

/** A field draft — the only shape the state knows; no provenance field exists. */
function field(id: string, over: Partial<SignFieldDraft> = {}): SignFieldDraft {
  return {
    id,
    type: 'SIGNATURE',
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    recipientIndex: 0,
    ...over,
  };
}

function doc(id: string): DocumentSummary {
  return {
    id,
    title: '계약서',
    status: 'DRAFT',
    statusLabel: '작성 중',
    pageCount: 1,
    recipientCount: 0,
    sentAt: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    completedAt: null,
    downloadsReady: false,
  };
}

const fakeFile = { name: 'contract.pdf' } as unknown as File;

/** Snapshot with a document already set (post-upload), no fields yet. */
function uploaded(documentId = 'doc-1'): WizardState {
  return wizardReducer(initialWizardState, {
    type: 'SET_DOCUMENT',
    document: doc(documentId),
    file: fakeFile,
  });
}

describe('INJECT_ANALYZED_FIELDS — auto fields land in the same array, unmarked', () => {
  it('appends analyzed fields onto the shared fields array', () => {
    const withManual = wizardReducer(uploaded(), {
      type: 'SET_FIELDS',
      fields: [field('manual-1')],
    });

    const next = wizardReducer(withManual, {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1', { type: 'DATE' }), field('auto-2', { type: 'TEXT' })],
    });

    // Manual field first (placed while analysis ran), auto fields appended after.
    expect(next.fields.map((f) => f.id)).toEqual(['manual-1', 'auto-1', 'auto-2']);
    expect(next.analyzedDocumentId).toBe('doc-1');
  });

  it('leaves no origin/provenance marker distinguishing an auto field from a manual one', () => {
    const next = wizardReducer(uploaded(), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1')],
    });

    const auto = next.fields[0]!;
    const manual = field('manual-1');
    // Same key set → the state layer cannot tell them apart.
    expect(Object.keys(auto).sort()).toEqual(Object.keys(manual).sort());
    for (const marker of ['origin', 'source', 'auto', 'analyzed', 'provenance']) {
      expect(marker in auto).toBe(false);
    }
  });
});

describe('one-shot guard — an auto injection never overwrites the user’s edits', () => {
  function injectedThenEdited() {
    const injected = wizardReducer(uploaded(), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1'), field('auto-2')],
    });
    // User moves auto-1, resizes it, and deletes auto-2 — all via SET_FIELDS.
    return wizardReducer(injected, {
      type: 'SET_FIELDS',
      fields: [field('auto-1', { x: 0.7, y: 0.6, width: 0.3, height: 0.09 })],
    });
  }

  it('ignores a duplicate injection for the already-analyzed document', () => {
    const edited = injectedThenEdited();
    const again = wizardReducer(edited, {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1'), field('auto-2')],
    });

    expect(again).toBe(edited); // same reference — no state change at all
    expect(again.fields.map((f) => f.id)).toEqual(['auto-1']); // deleted auto-2 stays gone
    expect(again.fields[0]).toMatchObject({ x: 0.7, y: 0.6, width: 0.3, height: 0.09 });
  });

  it('ignores a late-arriving response after the user re-entered and edited', () => {
    // Simulates a slow analyze() resolving after edits: same documentId, guarded.
    const edited = injectedThenEdited();
    const late = wizardReducer(edited, {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1'), field('auto-2'), field('auto-3')],
    });
    expect(late.fields.map((f) => f.id)).toEqual(['auto-1']);
  });

  it('MARK_ANALYZED (empty result) also arms the guard so nothing re-injects', () => {
    const marked = wizardReducer(uploaded(), {
      type: 'MARK_ANALYZED',
      documentId: 'doc-1',
    });
    expect(marked.analyzedDocumentId).toBe('doc-1');

    const edited = wizardReducer(marked, {
      type: 'SET_FIELDS',
      fields: [field('manual-1')],
    });
    const late = wizardReducer(edited, {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1')],
    });
    expect(late).toBe(edited);
    expect(late.fields.map((f) => f.id)).toEqual(['manual-1']);
  });
});

describe('SET_FIELDS — edit and delete apply uniformly regardless of origin', () => {
  it('persists a move/resize of an auto field the same as a manual one', () => {
    const injected = wizardReducer(uploaded(), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1')],
    });
    const withBoth = wizardReducer(injected, {
      type: 'SET_FIELDS',
      fields: [...injected.fields, field('manual-1')],
    });

    // Move+resize the auto field, move the manual field.
    const edited = wizardReducer(withBoth, {
      type: 'SET_FIELDS',
      fields: [
        field('auto-1', { x: 0.5, y: 0.5, width: 0.4, height: 0.1 }),
        field('manual-1', { x: 0.2, y: 0.3 }),
      ],
    });
    expect(edited.fields[0]).toMatchObject({ id: 'auto-1', x: 0.5, y: 0.5, width: 0.4, height: 0.1 });
    expect(edited.fields[1]).toMatchObject({ id: 'manual-1', x: 0.2, y: 0.3 });
  });

  it('deletes an auto field by omitting it from the next fields array', () => {
    const injected = wizardReducer(uploaded(), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1'), field('auto-2')],
    });
    const afterDelete = wizardReducer(injected, {
      type: 'SET_FIELDS',
      fields: injected.fields.filter((f) => f.id !== 'auto-1'),
    });
    expect(afterDelete.fields.map((f) => f.id)).toEqual(['auto-2']);
    // The guard is untouched by edits, so the delete can't be undone by re-entry.
    expect(afterDelete.analyzedDocumentId).toBe('doc-1');
  });
});

describe('re-upload resets fields and the one-shot guard', () => {
  it('SET_DOCUMENT clears fields and analyzedDocumentId for the new document', () => {
    const injected = wizardReducer(uploaded('doc-1'), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1')],
    });

    const reuploaded = wizardReducer(injected, {
      type: 'SET_DOCUMENT',
      document: doc('doc-2'),
      file: fakeFile,
    });
    expect(reuploaded.fields).toEqual([]);
    expect(reuploaded.analyzedDocumentId).toBeNull();
    expect(reuploaded.document?.id).toBe('doc-2');

    // The new document gets its own one-shot injection (guard was reset).
    const reinjected = wizardReducer(reuploaded, {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-2',
      fields: [field('auto-x')],
    });
    expect(reinjected.fields.map((f) => f.id)).toEqual(['auto-x']);
  });

  it('CLEAR_DOCUMENT resets fields and analyzedDocumentId', () => {
    const injected = wizardReducer(uploaded('doc-1'), {
      type: 'INJECT_ANALYZED_FIELDS',
      documentId: 'doc-1',
      fields: [field('auto-1')],
    });
    const cleared = wizardReducer(injected, { type: 'CLEAR_DOCUMENT' });
    expect(cleared.fields).toEqual([]);
    expect(cleared.analyzedDocumentId).toBeNull();
    expect(cleared.document).toBeNull();
  });
});
