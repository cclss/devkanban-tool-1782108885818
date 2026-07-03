'use client';

/**
 * Signer flow state machine + shared context.
 *
 * One signing link drives a small client state machine:
 *
 *   loading ──▶ verify ──▶ clauses ──▶ viewing ──▶ signing ──▶ done
 *      │                   (READY cards only; otherwise verify ──▶ viewing)
 *      └─▶ blocked (invalidLink | alreadySigned | unavailable)
 *
 * The happy path threads the AI key-clause reminder (`clauses`, M2) between
 * identity check and the document viewer; non-signable links branch to a
 * friendly `blocked` terminal with a reason. The clause stack is an auxiliary
 * reminder, never a gate: when the send-time extraction isn't `READY` with
 * cards, verify routes straight to `viewing` (the full-PDF fallback). Later
 * grains own signature capture (`signing`) and the completion screen (`done`),
 * binding to the `payload` + `session` this context already holds.
 *
 * The shell owns chrome and routing-free state; steps read state and dispatch
 * intent (`verify`), never mutating phase directly — mirroring the sender
 * wizard's centralized-navigation contract.
 */

import * as React from 'react';
import type { ClauseExtractionStatus } from '@repo/db';
import { ApiError } from '@/lib/api';
import {
  completeSigning,
  fetchClauses,
  fetchMeta,
  fetchPayload,
  getSignerSession,
  setSignerSession,
  verifyCode,
  SIGNER_COPY,
  type ClauseCard,
  type ClauseCardsResult,
  type SigningMeta,
  type SigningPayload,
} from '@/lib/signing';

/**
 * A value the signer has captured for one field, read back by the viewer to
 * reflect it inline on the page. The capture UI (signature canvas, font picker,
 * date) is a later grain; the viewer only needs the rendered payload, so the
 * shapes here are the read contract that grain binds to.
 */
export type SignerFieldValue =
  | { type: 'SIGNATURE'; /** Captured signature as a PNG data URL. */ dataUrl: string }
  | { type: 'TEXT'; text: string; /** Optional chosen signature font. */ fontFamily?: string }
  | { type: 'DATE'; text: string };

export type SignerPhase =
  | 'loading'
  | 'verify'
  | 'clauses'
  | 'viewing'
  | 'signing'
  | 'done'
  | 'blocked';

export type BlockReason = 'invalidLink' | 'alreadySigned' | 'unavailable';

export interface SignerState {
  phase: SignerPhase;
  /** Available once meta resolves (absent only while loading / invalid link). */
  meta: SigningMeta | null;
  /** The signer's working set, fetched right after a successful verify. */
  payload: SigningPayload | null;
  /** Why a link is non-signable, when `phase === 'blocked'`. */
  blockReason: BlockReason | null;
  /** Values captured per field id; the viewer reflects these inline. */
  fieldValues: Record<string, SignerFieldValue>;
  /** The field whose capture sheet is open (drives the BottomSheet target). */
  activeFieldId: string | null;
  /** Set once `complete` succeeds: whether the whole document is now finalized. */
  documentCompleted: boolean;
  /**
   * AI-extracted key-clause cards (M2), fetched right after a successful verify.
   * `null` while the fetch is in flight; an empty array once it settles with no
   * cards — the signal to fall back to the full-PDF view.
   */
  clauses: ClauseCard[] | null;
  /**
   * The document's cached clause-extraction status echoed by the server (or
   * `FAILED` when the fetch itself errors/times out). `null` until the clause
   * fetch settles; any non-`READY` value means "no cards — use the PDF view".
   */
  clauseStatus: ClauseExtractionStatus | null;
  /**
   * Whether the returnable, read-only full-document overlay is open (M2 grain-4).
   * The clause stack's '전체 원문 보기' opens the source PDF as a modal on top of
   * the cards; closing returns to the stack. It's an overlay flag, not a phase —
   * opening/closing never mutates `phase`, so the signer lands right back on the
   * same card. Orthogonal to the signing viewer's own PDF (a different phase).
   */
  previewOpen: boolean;
}

const initialState: SignerState = {
  phase: 'loading',
  meta: null,
  payload: null,
  blockReason: null,
  fieldValues: {},
  activeFieldId: null,
  documentCompleted: false,
  clauses: null,
  clauseStatus: null,
  previewOpen: false,
};

type SignerAction =
  | { type: 'META_OK'; meta: SigningMeta }
  | { type: 'BLOCK'; reason: BlockReason; meta: SigningMeta | null }
  | {
      type: 'VERIFIED';
      payload: SigningPayload;
      clauses: ClauseCard[];
      clauseStatus: ClauseExtractionStatus;
    }
  | { type: 'GO_SIGNING' }
  | { type: 'OPEN_PREVIEW' }
  | { type: 'CLOSE_PREVIEW' }
  | { type: 'DONE'; documentCompleted: boolean }
  | { type: 'OPEN_FIELD'; fieldId: string }
  | { type: 'CLOSE_FIELD' }
  | { type: 'SET_FIELD_VALUE'; fieldId: string; value: SignerFieldValue };

function reducer(state: SignerState, action: SignerAction): SignerState {
  switch (action.type) {
    case 'META_OK':
      return { ...state, phase: 'verify', meta: action.meta, blockReason: null };
    case 'BLOCK':
      return {
        ...state,
        phase: 'blocked',
        meta: action.meta ?? state.meta,
        blockReason: action.reason,
      };
    case 'VERIFIED': {
      // The clause reminder is shown only when the send-time extraction is
      // `READY` with at least one card; every other outcome (empty / failed /
      // pending) routes straight to the full-PDF viewer. The cards are an aid,
      // not a gate — so a missing set never blocks reaching the document.
      const hasClauseCards =
        action.clauseStatus === 'READY' && action.clauses.length > 0;
      return {
        ...state,
        phase: hasClauseCards ? 'clauses' : 'viewing',
        payload: action.payload,
        clauses: action.clauses,
        clauseStatus: action.clauseStatus,
      };
    }
    case 'GO_SIGNING':
      // The clause reminder's single '서명하기' CTA hands off to the document
      // viewer, where the actual field capture happens.
      return { ...state, phase: 'viewing' };
    case 'OPEN_PREVIEW':
      // '전체 원문 보기' opens the read-only source PDF over the card stack; the
      // phase is untouched so closing returns to the very same card.
      return { ...state, previewOpen: true };
    case 'CLOSE_PREVIEW':
      return { ...state, previewOpen: false };
    case 'DONE':
      return { ...state, phase: 'done', documentCompleted: action.documentCompleted };
    case 'OPEN_FIELD':
      return { ...state, activeFieldId: action.fieldId };
    case 'CLOSE_FIELD':
      return { ...state, activeFieldId: null };
    case 'SET_FIELD_VALUE':
      return {
        ...state,
        fieldValues: { ...state.fieldValues, [action.fieldId]: action.value },
        // Capturing a value closes the active sheet for that field.
        activeFieldId: state.activeFieldId === action.fieldId ? null : state.activeFieldId,
      };
    default:
      return state;
  }
}

/** Map a resolved meta onto the right entry phase. */
function blockReasonFor(meta: SigningMeta): BlockReason | null {
  if (meta.alreadySigned) return 'alreadySigned';
  if (!meta.signable) return 'unavailable';
  return null;
}

interface SignerContextValue {
  state: SignerState;
  /** The SignRequest access token for this link (PDF stream, session lookup). */
  token: string;
  /**
   * Verify the 6-digit code, then load the signer's payload and advance to the
   * viewer. Rejects (with the server's Toss-tone message) on a wrong/expired
   * code so the screen can shake + reset without leaving `verify`.
   */
  verify: (code: string) => Promise<void>;
  /** Leave the clause reminder ('서명하기') and open the document viewer. */
  goSigning: () => void;
  /**
   * Open the returnable, read-only full-document overlay ('전체 원문 보기') on top
   * of the clause stack. Phase is untouched, so `closePreview` returns to the card.
   */
  openPreview: () => void;
  /** Dismiss the read-only full-document overlay and return to the card stack. */
  closePreview: () => void;
  /**
   * Finalize the signer's part: call `/complete`, then advance to the completion
   * screen on success. Rejects (with the server's Toss-tone message) on failure
   * so the viewer can show a friendly retry — the captured field values stay put.
   */
  complete: () => Promise<void>;
  /** Open the capture sheet targeting a field (the BottomSheet is a later grain). */
  openField: (fieldId: string) => void;
  /** Dismiss the capture sheet without changing any value. */
  closeField: () => void;
  /** Record a captured value for a field; the viewer reflects it inline. */
  setFieldValue: (fieldId: string, value: SignerFieldValue) => void;
}

const SignerContext = React.createContext<SignerContextValue | null>(null);

export function SignerProvider({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(reducer, initialState);

  // Load pre-auth metadata once per link, then route to verify / blocked.
  React.useEffect(() => {
    let active = true;
    fetchMeta(token)
      .then((meta) => {
        if (!active) return;
        const reason = blockReasonFor(meta);
        if (reason) dispatch({ type: 'BLOCK', reason, meta });
        else dispatch({ type: 'META_OK', meta });
      })
      .catch((error) => {
        if (!active) return;
        // A 404 (or any meta failure) means the link itself isn't usable.
        const reason: BlockReason =
          error instanceof ApiError && error.status === 404
            ? 'invalidLink'
            : 'invalidLink';
        dispatch({ type: 'BLOCK', reason, meta: null });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const verify = React.useCallback(
    async (code: string) => {
      const { sessionToken } = await verifyCode(token, code);
      setSignerSession(token, sessionToken);
      // Hand the signer's fields + (implicit) session to the viewer.
      const payload = await fetchPayload(token, sessionToken);
      // Resolve the cached clause cards up front so the post-verify entry screen
      // is decided in one transition (READY cards → the reminder stack; anything
      // else → the full-PDF viewer). The cards are an auxiliary reminder, never
      // a gate: any rejection (network / timeout) — like a server-signalled
      // non-READY status — resolves to an empty set so the flow falls back to
      // the viewer. This catch keeps `verify()` from ever rejecting on the
      // clause fetch; only the code check / payload load can fail the screen.
      const clauseResult = await fetchClauses(token, sessionToken).catch(
        (): ClauseCardsResult => ({ status: 'FAILED', clauses: [] }),
      );
      dispatch({
        type: 'VERIFIED',
        payload,
        clauses: clauseResult.clauses,
        clauseStatus: clauseResult.status,
      });
    },
    [token],
  );

  const goSigning = React.useCallback(() => dispatch({ type: 'GO_SIGNING' }), []);
  const openPreview = React.useCallback(() => dispatch({ type: 'OPEN_PREVIEW' }), []);
  const closePreview = React.useCallback(() => dispatch({ type: 'CLOSE_PREVIEW' }), []);
  const complete = React.useCallback(async () => {
    const session = getSignerSession(token);
    if (!session) {
      // The session is required to finalize; a missing one means it expired or
      // the tab lost it. Surface a neutral error so the viewer offers a retry.
      throw new ApiError(SIGNER_COPY.completeError, 401);
    }
    const result = await completeSigning(token, session);
    dispatch({ type: 'DONE', documentCompleted: result.documentCompleted });
  }, [token]);
  const openField = React.useCallback(
    (fieldId: string) => dispatch({ type: 'OPEN_FIELD', fieldId }),
    [],
  );
  const closeField = React.useCallback(() => dispatch({ type: 'CLOSE_FIELD' }), []);
  const setFieldValue = React.useCallback(
    (fieldId: string, value: SignerFieldValue) =>
      dispatch({ type: 'SET_FIELD_VALUE', fieldId, value }),
    [],
  );

  const value = React.useMemo<SignerContextValue>(
    () => ({
      state,
      token,
      verify,
      goSigning,
      openPreview,
      closePreview,
      complete,
      openField,
      closeField,
      setFieldValue,
    }),
    [
      state,
      token,
      verify,
      goSigning,
      openPreview,
      closePreview,
      complete,
      openField,
      closeField,
      setFieldValue,
    ],
  );

  return <SignerContext.Provider value={value}>{children}</SignerContext.Provider>;
}

export function useSigner(): SignerContextValue {
  const ctx = React.useContext(SignerContext);
  if (!ctx) throw new Error('useSigner must be used within a SignerProvider');
  return ctx;
}
