'use client';

/**
 * Contract-creation wizard state.
 *
 * The shell (contract-wizard.tsx) owns the StepIndicator, step transitions, and
 * footer navigation; this module owns the *data* that flows across steps so each
 * step is a thin, stateless slot.
 *
 * The step sequence is not a fixed list — it forks on how the finished contract
 * is delivered. Every contract shares the lead-in:
 *
 *   upload → place fields → delivery method
 *
 * then the chosen `deliveryMethod` decides the tail:
 *
 *   'email' → recipients → review/send   (the classic path)
 *   'link'  → share link                 (generate a shareable link)
 *
 * Steps are addressed by a stable `StepKey`, never a raw index, so the branch
 * can grow or shrink without index math drifting. `state.step` is still the
 * cursor, but it indexes into `stepSequence(deliveryMethod)`.
 *
 * Steps never advance themselves: they populate state, and `canProceed()`
 * derives whether the shell's "다음" button unlocks. This keeps the gating in
 * one declarative place as later grains fill in their slots.
 */

import * as React from 'react';
import type { DocumentSummary } from '@/lib/documents';
import { recipientsComplete } from '@/lib/recipients';

export type SignFieldType = 'SIGNATURE' | 'DATE' | 'TEXT';

/** A placed sign field. Geometry is normalized 0–1 relative to its page. */
export interface SignFieldDraft {
  id: string;
  type: SignFieldType;
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-based recipient index this field is assigned to. */
  recipientIndex?: number;
  /**
   * How the field got onto the canvas. Absent/'manual' = the user placed it;
   * 'auto' = it came from AI auto-placement (`fetchFieldSuggestions`). Purely a
   * client-side render/UX marker (violet suggestion styling, "제안 모두 지우기");
   * it never reaches the server — `saveFields` omits it so the persisted
   * `SignFieldDto` contract is unchanged.
   */
  source?: 'auto' | 'manual';
}

export interface RecipientDraft {
  id: string;
  email: string;
  name: string;
}

/** How the finished contract reaches its signer. */
export type DeliveryMethod = 'email' | 'link';

/**
 * A single wizard step, addressed by a stable key rather than a raw index so
 * the sequence can branch on the chosen delivery method.
 */
export type StepKey = 'upload' | 'fields' | 'delivery' | 'recipients' | 'review' | 'link';

/** Human labels for each step. These surface in the StepIndicator. */
export const STEP_LABELS: Record<StepKey, string> = {
  upload: '업로드',
  fields: '필드 배치',
  delivery: '전달 방법',
  recipients: '받는 분',
  review: '발송 검토',
  link: '링크 공유',
};

/** Steps every contract passes through, up to the delivery-method fork. */
const COMMON_STEPS: readonly StepKey[] = ['upload', 'fields', 'delivery'];
/** Tail that follows an 'email' choice. */
const EMAIL_STEPS: readonly StepKey[] = ['recipients', 'review'];
/** Tail that follows a 'link' choice. */
const LINK_STEPS: readonly StepKey[] = ['link'];

/**
 * The ordered step keys for the current delivery choice. Until a method is
 * picked the sequence stops at 'delivery'; `canProceed()` keeps "다음" locked
 * there so the flow can't run past an unmade branch decision.
 */
export function stepSequence(deliveryMethod: DeliveryMethod | null): readonly StepKey[] {
  if (deliveryMethod === 'email') return [...COMMON_STEPS, ...EMAIL_STEPS];
  if (deliveryMethod === 'link') return [...COMMON_STEPS, ...LINK_STEPS];
  return COMMON_STEPS;
}

export interface WizardState {
  step: number;
  /** Travel direction of the last step change, for the transition animation. */
  direction: 1 | -1;
  /** The DRAFT document created on upload (server source of truth). */
  document: DocumentSummary | null;
  /** The locally selected PDF, kept for client-side preview/render. */
  file: File | null;
  fields: SignFieldDraft[];
  recipients: RecipientDraft[];
  /** Chosen delivery path; null until the user picks at the 'delivery' step. */
  deliveryMethod: DeliveryMethod | null;
}

export const initialWizardState: WizardState = {
  step: 0,
  direction: 1,
  document: null,
  file: null,
  fields: [],
  recipients: [],
  deliveryMethod: null,
};

type WizardAction =
  | { type: 'SET_DOCUMENT'; document: DocumentSummary; file: File }
  | { type: 'CLEAR_DOCUMENT' }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO'; step: number }
  | { type: 'SET_FIELDS'; fields: SignFieldDraft[] }
  | { type: 'SET_RECIPIENTS'; recipients: RecipientDraft[] }
  | { type: 'SET_DELIVERY_METHOD'; method: DeliveryMethod };

/** Clamp a cursor into the sequence valid for the given delivery method. */
function clampStep(step: number, deliveryMethod: DeliveryMethod | null): number {
  const last = stepSequence(deliveryMethod).length - 1;
  return Math.max(0, Math.min(last, step));
}

/** The key of the step the cursor currently sits on. */
export function currentStepKey(state: WizardState): StepKey {
  const seq = stepSequence(state.deliveryMethod);
  return seq[state.step] ?? seq[seq.length - 1]!;
}

/**
 * Whether the active step is the terminal step of a chosen delivery branch.
 * Terminal steps ('발송 검토' / '링크 공유') render their own CTA, so the shell
 * hides its footer "다음" there. The 'delivery' fork is never terminal — even
 * though it is transiently the last entry while no method is chosen, it still
 * needs "다음" to move into the selected branch.
 */
export function isLastStep(state: WizardState): boolean {
  if (state.deliveryMethod === null) return false;
  return state.step === stepSequence(state.deliveryMethod).length - 1;
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_DOCUMENT':
      // Re-uploading replaces the draft; fields were placed against the old
      // document's pages, so drop them to avoid stale geometry.
      return { ...state, document: action.document, file: action.file, fields: [] };
    case 'CLEAR_DOCUMENT':
      return { ...state, document: null, file: null, fields: [] };
    case 'GO_NEXT': {
      const step = clampStep(state.step + 1, state.deliveryMethod);
      return { ...state, step, direction: 1 };
    }
    case 'GO_BACK': {
      const step = clampStep(state.step - 1, state.deliveryMethod);
      return { ...state, step, direction: -1 };
    }
    case 'GO_TO': {
      const step = clampStep(action.step, state.deliveryMethod);
      return { ...state, step, direction: step >= state.step ? 1 : -1 };
    }
    case 'SET_FIELDS':
      return { ...state, fields: action.fields };
    case 'SET_RECIPIENTS':
      return { ...state, recipients: action.recipients };
    case 'SET_DELIVERY_METHOD':
      // Chosen at the 'delivery' step (a common step present in every branch),
      // so the cursor stays valid; re-clamp defensively in case the tail shrank.
      return {
        ...state,
        deliveryMethod: action.method,
        step: clampStep(state.step, action.method),
      };
    default:
      return state;
  }
}

/** Whether the current step is complete enough to advance. */
export function canProceed(state: WizardState): boolean {
  switch (currentStepKey(state)) {
    case 'upload':
      return state.document !== null;
    case 'fields':
      return state.fields.length > 0;
    case 'delivery':
      // Locks "다음" until the user picks how the contract is delivered.
      return state.deliveryMethod !== null;
    case 'recipients':
      // Need ≥1 recipient and every recipient passing inline validation
      // (email present, well-formed, no duplicates).
      return recipientsComplete(state.recipients);
    default:
      // 'review' / 'link' terminals own their CTA; nothing to gate here.
      return true;
  }
}

interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  goNext: () => void;
  goBack: () => void;
}

const WizardContext = React.createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(wizardReducer, initialWizardState);
  const goNext = React.useCallback(() => dispatch({ type: 'GO_NEXT' }), []);
  const goBack = React.useCallback(() => dispatch({ type: 'GO_BACK' }), []);
  const value = React.useMemo(
    () => ({ state, dispatch, goNext, goBack }),
    [state, goNext, goBack],
  );
  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = React.useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within a WizardProvider');
  return ctx;
}
