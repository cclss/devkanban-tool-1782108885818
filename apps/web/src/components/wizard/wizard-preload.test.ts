import {
  preloadedWizardState,
  stepIndexOf,
  wizardReducer,
  currentStepKey,
  canProceed,
  isLastStep,
  type WizardPreload,
  type SignFieldDraft,
  type RecipientDraft,
} from './wizard-context';
import type { DocumentSummary } from '@/lib/documents';

const doc = { id: 'doc_1', title: '근로계약서' } as unknown as DocumentSummary;
const file = new File(['%PDF-1.4'], 'template.pdf', { type: 'application/pdf' });
const fields: SignFieldDraft[] = [
  { id: 'f1', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05, recipientIndex: 0 },
];

function preload(over: Partial<WizardPreload> = {}): WizardPreload {
  return { document: doc, file, fields, ...over };
}

describe('preloadedWizardState', () => {
  it('opens on the delivery-method step with no branch chosen yet', () => {
    const state = preloadedWizardState(preload());
    // Same email/link choice as the from-scratch path — nothing preselected.
    expect(state.deliveryMethod).toBeNull();
    expect(state.step).toBe(stepIndexOf(null, 'delivery'));
    expect(currentStepKey(state)).toBe('delivery');
    // "다음" stays locked until the user picks how the contract is delivered.
    expect(canProceed(state)).toBe(false);
  });

  it('carries the document, file, and saved field layout', () => {
    const state = preloadedWizardState(preload());
    expect(state.document).toBe(doc);
    expect(state.file).toBe(file);
    expect(state.fields).toEqual(fields);
    // The delivery choice (and anything past it) is all that's left to fill in.
    expect(state.recipients).toEqual([]);
    expect(canProceed(state)).toBe(false);
  });

  it('honors an explicit delivery branch override', () => {
    const state = preloadedWizardState(preload({ deliveryMethod: 'link' }));
    // An explicit branch is still respected rather than being reset to null.
    expect(state.deliveryMethod).toBe('link');
    // The cursor opens on the delivery step (present in every branch).
    expect(state.step).toBe(stepIndexOf('link', 'delivery'));
    expect(currentStepKey(state)).toBe('delivery');
  });

  it('advances into the link branch once the user picks link', () => {
    let state = preloadedWizardState(preload());
    state = wizardReducer(state, { type: 'SET_DELIVERY_METHOD', method: 'link' });
    expect(canProceed(state)).toBe(true);
    state = wizardReducer(state, { type: 'GO_NEXT' });
    expect(currentStepKey(state)).toBe('link');
  });

  it('advances into the email branch once the user picks email', () => {
    let state = preloadedWizardState(preload());
    state = wizardReducer(state, { type: 'SET_DELIVERY_METHOD', method: 'email' });
    state = wizardReducer(state, { type: 'GO_NEXT' });
    expect(currentStepKey(state)).toBe('recipients');
  });

  it('runs the email tail recipients → review exactly like the from-scratch path', () => {
    let state = preloadedWizardState(preload());
    // Pick email at the (now shared) delivery step and step into 받는 분.
    state = wizardReducer(state, { type: 'SET_DELIVERY_METHOD', method: 'email' });
    state = wizardReducer(state, { type: 'GO_NEXT' });
    expect(currentStepKey(state)).toBe('recipients');
    // 받는 분 is not terminal and "다음" stays locked until a valid recipient exists.
    expect(isLastStep(state)).toBe(false);
    expect(canProceed(state)).toBe(false);

    // An incomplete recipient (no email) still can't proceed…
    const blank: RecipientDraft = { id: 'r1', email: '', name: '' };
    state = wizardReducer(state, { type: 'SET_RECIPIENTS', recipients: [blank] });
    expect(canProceed(state)).toBe(false);

    // …a well-formed recipient unlocks it.
    const valid: RecipientDraft = { id: 'r1', email: 'signer@example.com', name: '홍길동' };
    state = wizardReducer(state, { type: 'SET_RECIPIENTS', recipients: [valid] });
    expect(canProceed(state)).toBe(true);

    // Advancing lands on the terminal review/send step, which owns its own CTA.
    state = wizardReducer(state, { type: 'GO_NEXT' });
    expect(currentStepKey(state)).toBe('review');
    expect(isLastStep(state)).toBe(true);
    // The send tail is gated by the ReviewStep CTA, not the footer, so nothing
    // to gate here — and the review state still carries everything send needs.
    expect(canProceed(state)).toBe(true);
    expect(state.document).toBe(doc);
    expect(state.fields).toEqual(fields);
    expect(state.recipients).toEqual([valid]);
  });

  it('honors an explicit email override by opening on the shared delivery step', () => {
    const state = preloadedWizardState(preload({ deliveryMethod: 'email' }));
    // A pre-selected email branch still opens on the delivery step (present in
    // every branch) rather than skipping ahead to 받는 분.
    expect(state.deliveryMethod).toBe('email');
    expect(state.step).toBe(stepIndexOf('email', 'delivery'));
    expect(currentStepKey(state)).toBe('delivery');
    // "다음" is already unlocked because the branch is chosen.
    expect(canProceed(state)).toBe(true);
  });

  it('lets the user step back through the pre-filled common steps', () => {
    let state = preloadedWizardState(preload());
    expect(currentStepKey(state)).toBe('delivery');
    state = wizardReducer(state, { type: 'GO_BACK' });
    expect(currentStepKey(state)).toBe('fields');
    expect(canProceed(state)).toBe(true); // fields are populated from the template
    state = wizardReducer(state, { type: 'GO_BACK' });
    expect(currentStepKey(state)).toBe('upload');
    expect(state.step).toBe(0);
  });

  it('drops the template fields when the source PDF is re-uploaded', () => {
    let state = preloadedWizardState(preload());
    const newDoc = { id: 'doc_2', title: '재업로드' } as unknown as DocumentSummary;
    const newFile = new File(['%PDF-1.4 v2'], 'reupload.pdf', { type: 'application/pdf' });
    state = wizardReducer(state, { type: 'SET_DOCUMENT', document: newDoc, file: newFile });
    expect(state.document).toBe(newDoc);
    expect(state.file).toBe(newFile);
    expect(state.fields).toEqual([]);
  });
});
