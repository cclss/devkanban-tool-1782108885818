'use client';

/**
 * Contract-creation wizard state.
 *
 * The shell (contract-wizard.tsx) owns the StepIndicator, step transitions, and
 * footer navigation; this module owns the *data* that flows across steps so each
 * step is a thin, stateless slot:
 *
 *   upload (grain-6)  → sets `document` + the local `file`
 *   place fields (7)  → sets `fields`
 *   recipients (8)    → sets `recipients`
 *   review/send (9)   → reads everything, dispatches the send
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
}

export interface RecipientDraft {
  id: string;
  email: string;
  name: string;
}

/** Ordered wizard steps. The labels surface in the StepIndicator. */
export const WIZARD_STEPS = ['업로드', '필드 배치', '받는 분', '발송 검토'] as const;
export const LAST_STEP = WIZARD_STEPS.length - 1;

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
  /**
   * The document id whose AI auto-analysis has already been injected (or ran and
   * found nothing). Gates the one-shot auto-placement so re-entering the field
   * step never re-injects over the user's manual edits. Reset on (re)upload.
   */
  analyzedDocumentId: string | null;
}

export const initialWizardState: WizardState = {
  step: 0,
  direction: 1,
  document: null,
  file: null,
  fields: [],
  recipients: [],
  analyzedDocumentId: null,
};

type WizardAction =
  | { type: 'SET_DOCUMENT'; document: DocumentSummary; file: File }
  | { type: 'CLEAR_DOCUMENT' }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO'; step: number }
  | { type: 'SET_FIELDS'; fields: SignFieldDraft[] }
  | { type: 'INJECT_ANALYZED_FIELDS'; documentId: string; fields: SignFieldDraft[] }
  | { type: 'MARK_ANALYZED'; documentId: string }
  | { type: 'SET_RECIPIENTS'; recipients: RecipientDraft[] };

function clampStep(step: number): number {
  return Math.max(0, Math.min(LAST_STEP, step));
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_DOCUMENT':
      // Re-uploading replaces the draft; fields were placed against the old
      // document's pages, so drop them to avoid stale geometry. Also clear the
      // analyzed marker so the new document gets its own one-shot auto-analysis.
      return {
        ...state,
        document: action.document,
        file: action.file,
        fields: [],
        analyzedDocumentId: null,
      };
    case 'CLEAR_DOCUMENT':
      return { ...state, document: null, file: null, fields: [], analyzedDocumentId: null };
    case 'GO_NEXT': {
      const step = clampStep(state.step + 1);
      return { ...state, step, direction: 1 };
    }
    case 'GO_BACK': {
      const step = clampStep(state.step - 1);
      return { ...state, step, direction: -1 };
    }
    case 'GO_TO': {
      const step = clampStep(action.step);
      return { ...state, step, direction: step >= state.step ? 1 : -1 };
    }
    case 'SET_FIELDS':
      return { ...state, fields: action.fields };
    case 'INJECT_ANALYZED_FIELDS': {
      // One-shot per document: if this document was already analyzed, ignore.
      // The guard lives in the reducer so a double effect (StrictMode) or a
      // late-arriving response can never double-inject. Auto fields are appended
      // so any fields the user placed while analysis ran are preserved.
      if (state.analyzedDocumentId === action.documentId) return state;
      return {
        ...state,
        fields: [...state.fields, ...action.fields],
        analyzedDocumentId: action.documentId,
      };
    }
    case 'MARK_ANALYZED':
      // Analysis ran but produced nothing to inject — still mark it done so
      // re-entering the step doesn't re-run the empty analysis.
      if (state.analyzedDocumentId === action.documentId) return state;
      return { ...state, analyzedDocumentId: action.documentId };
    case 'SET_RECIPIENTS':
      return { ...state, recipients: action.recipients };
    default:
      return state;
  }
}

/** Whether the current step is complete enough to advance. */
export function canProceed(state: WizardState): boolean {
  switch (state.step) {
    case 0:
      return state.document !== null;
    case 1:
      return state.fields.length > 0;
    case 2:
      // Need ≥1 recipient and every recipient passing inline validation
      // (email present, well-formed, no duplicates).
      return recipientsComplete(state.recipients);
    default:
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
