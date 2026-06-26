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
import type { SignFieldSuggestion } from '@/lib/signfield-suggest';
import type { AnalysisPhase } from '@/lib/signfield-suggestion';

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
   * AI-proposed fields, kept *separate* from `fields` until the user confirms
   * one. Pending suggestions are never sent — only accepted (→ `fields`) ones
   * flow through the existing normalize/save path.
   */
  suggestions: SignFieldSuggestion[];
  /** Lifecycle of the AI auto-placement run for the current document. */
  analysis: AnalysisPhase;
}

export const initialWizardState: WizardState = {
  step: 0,
  direction: 1,
  document: null,
  file: null,
  fields: [],
  recipients: [],
  suggestions: [],
  analysis: { status: 'idle' },
};

type WizardAction =
  | { type: 'SET_DOCUMENT'; document: DocumentSummary; file: File }
  | { type: 'CLEAR_DOCUMENT' }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'GO_TO'; step: number }
  | { type: 'SET_FIELDS'; fields: SignFieldDraft[] }
  | { type: 'SET_RECIPIENTS'; recipients: RecipientDraft[] }
  // AI auto-placement: lifecycle + the pending-suggestion collection.
  | { type: 'ANALYSIS_START' }
  | { type: 'ANALYSIS_DONE'; suggestions: SignFieldSuggestion[] }
  | { type: 'ANALYSIS_EMPTY'; message: string }
  | { type: 'ANALYSIS_ERROR'; message: string }
  /** Confirm one suggestion: append the (already-converted) field, drop the suggestion. */
  | { type: 'ACCEPT_SUGGESTION'; field: SignFieldDraft; suggestionId: string }
  /** Confirm every suggestion at once ("모두 적용"). */
  | { type: 'ACCEPT_ALL_SUGGESTIONS'; fields: SignFieldDraft[] }
  /** Discard one suggestion without accepting it. */
  | { type: 'DISMISS_SUGGESTION'; suggestionId: string }
  /** Discard every suggestion ("지우기"). */
  | { type: 'CLEAR_SUGGESTIONS' };

function clampStep(step: number): number {
  return Math.max(0, Math.min(LAST_STEP, step));
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_DOCUMENT':
      // Re-uploading replaces the draft; fields were placed against the old
      // document's pages, so drop them to avoid stale geometry. AI suggestions +
      // analysis belong to the old file too — reset so the new file re-analyzes.
      return {
        ...state,
        document: action.document,
        file: action.file,
        fields: [],
        suggestions: [],
        analysis: { status: 'idle' },
      };
    case 'CLEAR_DOCUMENT':
      return {
        ...state,
        document: null,
        file: null,
        fields: [],
        suggestions: [],
        analysis: { status: 'idle' },
      };
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
    case 'SET_RECIPIENTS':
      return { ...state, recipients: action.recipients };
    case 'ANALYSIS_START':
      // Drop any prior suggestions so a re-run never shows stale proposals.
      return { ...state, analysis: { status: 'analyzing' }, suggestions: [] };
    case 'ANALYSIS_DONE':
      return { ...state, analysis: { status: 'done' }, suggestions: action.suggestions };
    case 'ANALYSIS_EMPTY':
      return { ...state, analysis: { status: 'empty', message: action.message }, suggestions: [] };
    case 'ANALYSIS_ERROR':
      return { ...state, analysis: { status: 'error', message: action.message }, suggestions: [] };
    case 'ACCEPT_SUGGESTION':
      return {
        ...state,
        fields: [...state.fields, action.field],
        suggestions: state.suggestions.filter((s) => s.id !== action.suggestionId),
      };
    case 'ACCEPT_ALL_SUGGESTIONS':
      return { ...state, fields: [...state.fields, ...action.fields], suggestions: [] };
    case 'DISMISS_SUGGESTION':
      return {
        ...state,
        suggestions: state.suggestions.filter((s) => s.id !== action.suggestionId),
      };
    case 'CLEAR_SUGGESTIONS':
      return { ...state, suggestions: [] };
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
