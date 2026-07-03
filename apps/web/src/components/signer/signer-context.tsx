'use client';

/**
 * Signer flow state machine + shared context.
 *
 * One signing link drives a small client state machine:
 *
 *   loading ──▶ verify ──▶ clauses ──▶ signing ──▶ done
 *      │            └─▶ viewing ──▶ signing   (no READY cards: PDF fallback)
 *      └─▶ blocked (invalidLink | alreadySigned | unavailable)
 *
 * The happy path threads the AI key-clause reminder (`clauses`, M2) between
 * identity check and signing; non-signable links branch to a friendly `blocked`
 * terminal with a reason. The clause stack is an auxiliary reminder, never a
 * gate: when the send-time extraction isn't `READY` with cards, verify routes
 * to `viewing` (the full-PDF fallback), whose bottom CTA / field tap still enters
 * the same guided flow.
 *
 * `signing` is the guided sequential mode (M3, `conventions/signing-flow.md`
 * SF1–SF8): the clause card's '서명하기' (`goSigning`) and the fallback viewer's
 * CTA both hand off here, and the reused `SignatureInputSheet` is driven through
 * the unfilled fields one at a time. `viewing` stays as the free-browse PDF
 * substrate/fallback (SF1/SF2). Applying a field auto-advances to the next
 * unfilled one (SF3); the last apply chains `complete()` once nothing remains
 * (SF6). The viewer's own field tap remains a non-linear override that also joins
 * the auto-advance flow (SF2). The completion screen (`done`) binds to the
 * `payload` + `session` this context already holds.
 *
 * The shell owns chrome and routing-free state; steps read state and dispatch
 * intent (`verify`), never mutating phase directly — mirroring the sender
 * wizard's centralized-navigation contract. The field ordering (page → top →
 * left) mirrors `document-viewer.tsx`'s `orderedUnfilled` (the sequencing single
 * source, SF3) so both surfaces walk the fields identically.
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
  type SigningPayloadField,
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

/**
 * A field is done when the signer captured a value this session, or the server
 * already holds one. Mirrors `document-viewer.tsx`'s `isFilled` (SF3).
 */
function isFilled(field: SigningPayloadField, values: Record<string, SignerFieldValue>): boolean {
  return values[field.id] != null || field.filled;
}

/** Top edge (normalized) of a field for top-to-bottom reading order. */
function topOf(field: SigningPayloadField): number {
  return 1 - field.y - field.height;
}

/**
 * All fields in guided walk order — page → top → left. This is the sequencing
 * single source (SF3), kept byte-identical to `document-viewer.tsx`'s
 * `orderedUnfilled` sort so the guided flow and the viewer traverse fields the
 * same way. '이전'/'다음' step through this full list (filled fields included, so
 * a captured value can be reviewed/edited, SF5).
 */
function orderFields(fields: SigningPayloadField[]): SigningPayloadField[] {
  return [...fields].sort((a, b) => a.page - b.page || topOf(a) - topOf(b) || a.x - b.x);
}

/** The still-unfilled fields in guided order — the auto-advance queue (SF3). */
function unfilledInOrder(
  fields: SigningPayloadField[],
  values: Record<string, SignerFieldValue>,
): SigningPayloadField[] {
  return orderFields(fields).filter((f) => !isFilled(f, values));
}

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
  /**
   * Guided-flow progress denominator N ("N곳 중 M곳째", SF4): the count of unfilled
   * fields snapshotted when `signing` starts, held fixed so skipping (SF5) never
   * makes it jitter. `null` until the guided flow is entered. The numerator M is
   * derived by the sheet (grain-4) from this and the live `orderedUnfilled` count.
   */
  guidedTotal: number | null;
  /**
   * A friendly, server-owned message when the final `complete()` fails mid-flow
   * (SF7). The flow stays on the last field with every captured value preserved
   * so the signer can retry; the sheet (grain-4) renders this. `null` otherwise.
   */
  signingError: string | null;
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
  guidedTotal: null,
  signingError: null,
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
  | { type: 'ENTER_SIGNING'; total: number; fieldId: string | null }
  | { type: 'GUIDED_COMMIT'; fieldId: string; value: SignerFieldValue; nextFieldId: string | null }
  | { type: 'GUIDED_NAV'; fieldId: string }
  | { type: 'SIGNING_ERROR'; message: string }
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
    case 'ENTER_SIGNING':
      // Enter the guided sequential mode (SF1): snapshot the unfilled count as the
      // fixed progress denominator N (SF4) and open the starting field's sheet
      // (SF3). `fieldId` is null only when nothing is unfilled — the caller then
      // chains `complete()` straight away (SF6).
      return {
        ...state,
        phase: 'signing',
        guidedTotal: action.total,
        activeFieldId: action.fieldId,
        signingError: null,
      };
    case 'GUIDED_COMMIT':
      // '적용' saved successfully: record the value (same as SET_FIELD_VALUE) and,
      // instead of closing, advance the open sheet onto the next unfilled field
      // (SF3). `nextFieldId` is the wrapped first-unfilled, or the just-filled id
      // when the queue is now empty (the sheet stays put while `complete()` runs).
      return {
        ...state,
        fieldValues: { ...state.fieldValues, [action.fieldId]: action.value },
        activeFieldId: action.nextFieldId,
        signingError: null,
      };
    case 'GUIDED_NAV':
      // Save-less move to another field for review/edit ('이전'/'다음'/'나중에', SF5).
      return { ...state, activeFieldId: action.fieldId, signingError: null };
    case 'SIGNING_ERROR':
      return { ...state, signingError: action.message };
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
  /**
   * Enter the guided sequential signing mode from the clause reminder's '서명하기'
   * CTA (SF1): snapshots the queue and opens the first unfilled field's sheet
   * (SF3). If nothing is unfilled it finalizes straight away (SF6).
   */
  goSigning: () => void;
  /**
   * The still-unfilled fields in guided order (page → top → left, SF3). The
   * sequencing single source the sheet (grain-4) reads to render "N곳 중 M곳째"
   * and to know when the queue is empty. Empty once every field is captured.
   */
  orderedUnfilled: SigningPayloadField[];
  /**
   * Progress denominator N for "N곳 중 M곳째" (SF4) — the unfilled count captured
   * when the guided flow started, held fixed. `null` before the flow is entered.
   */
  guidedTotal: number | null;
  /**
   * Server-owned message when the final `complete()` fails mid-flow (SF7); `null`
   * otherwise. The flow stays on the last field with values preserved for a retry.
   */
  signingError: string | null;
  /**
   * Save-less step to the previous field in guided order for review/edit ('이전',
   * SF5). No-op on the first field. Values are untouched.
   */
  signingPrev: () => void;
  /**
   * Save-less step to the next field in guided order ('다음', SF5) — for reviewing
   * an already-captured field. No-op on the last field. Values are untouched.
   */
  signingNext: () => void;
  /**
   * Leave the current field unfilled and jump to the next field still needing a
   * value, wrapping ('나중에', SF5). The skipped field stays in the queue and the
   * progress line keeps signalling it. No-op if it is the only field left unfilled.
   */
  signingSkip: () => void;
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
  /**
   * Open the capture sheet targeting a field. From the `viewing` fallback this is
   * the guided-flow entry point (SF1/SF2): the viewer's bottom CTA / field tap
   * routes here, so opening a field switches into `signing` and snapshots the
   * queue. Within `signing` it stays a non-linear override (jump to any field);
   * either way, applying then auto-advances (SF2/SF3).
   */
  openField: (fieldId: string) => void;
  /** Dismiss the capture sheet without changing any value. */
  closeField: () => void;
  /**
   * Record a captured value for a field; the viewer reflects it inline. In the
   * `signing` guided mode this additionally sequences the flow (SF3): a successful
   * apply advances the sheet to the next unfilled field, and the last one chains
   * `complete()` (SF6). Outside `signing` it just records + closes the sheet (the
   * viewer's non-linear edit path) — the persistence contract is unchanged.
   */
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

  // Guided callbacks fire from user events after render and must compute the next
  // field from the freshest state (queue shrinks as fields fill). A ref mirrors
  // the latest committed state so those callbacks stay identity-stable.
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // The live unfilled queue in guided order (SF3) — sequencing single source the
  // sheet (grain-4) reads for "N곳 중 M곳째" and to detect an empty queue.
  const orderedUnfilled = React.useMemo(
    () => unfilledInOrder(state.payload?.fields ?? [], state.fieldValues),
    [state.payload, state.fieldValues],
  );

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

  // The last guided apply chains completion (SF6). Unlike the viewer's `complete`
  // (which rejects for the CTA to catch), this swallows the failure into
  // `signingError` so the flow stays on the last field with values preserved for
  // a retry (SF7); on success `complete` flips the phase to `done`.
  const runGuidedComplete = React.useCallback(async () => {
    try {
      await complete();
    } catch (err) {
      dispatch({
        type: 'SIGNING_ERROR',
        message: err instanceof ApiError ? err.message : SIGNER_COPY.completeError,
      });
    }
  }, [complete]);

  const goSigning = React.useCallback(() => {
    // Clause card '서명하기' → guided sequential mode (SF1). Snapshot the unfilled
    // count as the fixed denominator N (SF4) and open the first unfilled field
    // (SF3); if everything is already filled, finalize straight away (SF6).
    const s = stateRef.current;
    const unfilled = unfilledInOrder(s.payload?.fields ?? [], s.fieldValues);
    dispatch({ type: 'ENTER_SIGNING', total: unfilled.length, fieldId: unfilled[0]?.id ?? null });
    if (unfilled.length === 0) void runGuidedComplete();
  }, [runGuidedComplete]);

  const openField = React.useCallback((fieldId: string) => {
    const s = stateRef.current;
    if (s.phase === 'viewing') {
      // Fallback entry (SF1/SF2): the viewer's bottom CTA / field tap opens a field
      // — that starts the guided flow. Snapshot N from the current queue and target
      // this field (which may be the CTA's first-unfilled or a tapped one).
      const unfilled = unfilledInOrder(s.payload?.fields ?? [], s.fieldValues);
      dispatch({ type: 'ENTER_SIGNING', total: unfilled.length, fieldId });
      return;
    }
    // Within `signing`, a tap is a non-linear override (SF2); elsewhere it just
    // opens the sheet. Either way the queue snapshot (guidedTotal) is untouched.
    dispatch({ type: 'OPEN_FIELD', fieldId });
  }, []);

  const closeField = React.useCallback(() => dispatch({ type: 'CLOSE_FIELD' }), []);

  const setFieldValue = React.useCallback(
    (fieldId: string, value: SignerFieldValue) => {
      const s = stateRef.current;
      if (s.phase !== 'signing') {
        // Viewer's non-linear edit path: record + close the sheet, unchanged.
        dispatch({ type: 'SET_FIELD_VALUE', fieldId, value });
        return;
      }
      // Guided apply (SF3): record the value, then auto-advance to the next
      // unfilled field (the wrapped first-unfilled, SF6). When the queue empties,
      // hold the sheet on this field and chain `complete()` (SF6).
      const nextValues = { ...s.fieldValues, [fieldId]: value };
      const remaining = unfilledInOrder(s.payload?.fields ?? [], nextValues);
      dispatch({
        type: 'GUIDED_COMMIT',
        fieldId,
        value,
        nextFieldId: remaining[0]?.id ?? fieldId,
      });
      if (remaining.length === 0) void runGuidedComplete();
    },
    [runGuidedComplete],
  );

  // Save-less guided navigation (SF5). '이전'/'다음' step through the full ordered
  // list (filled fields included, for review/edit); '나중에' jumps to the next
  // field still needing a value (wrapping), leaving the current one in the queue.
  const signingPrev = React.useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'signing' || !s.activeFieldId) return;
    const order = orderFields(s.payload?.fields ?? []);
    const idx = order.findIndex((f) => f.id === s.activeFieldId);
    const prev = idx > 0 ? order[idx - 1] : undefined;
    if (prev) dispatch({ type: 'GUIDED_NAV', fieldId: prev.id });
  }, []);

  const signingNext = React.useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'signing' || !s.activeFieldId) return;
    const order = orderFields(s.payload?.fields ?? []);
    const idx = order.findIndex((f) => f.id === s.activeFieldId);
    const next = idx >= 0 ? order[idx + 1] : undefined;
    if (next) dispatch({ type: 'GUIDED_NAV', fieldId: next.id });
  }, []);

  const signingSkip = React.useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'signing' || !s.activeFieldId) return;
    const order = orderFields(s.payload?.fields ?? []);
    const idx = order.findIndex((f) => f.id === s.activeFieldId);
    if (idx < 0) return;
    // First still-unfilled field after the current one, wrapping — skip its own id
    // so "the only unfilled field left" can't skip to itself.
    for (let step = 1; step < order.length; step++) {
      const candidate = order[(idx + step) % order.length];
      if (candidate && candidate.id !== s.activeFieldId && !isFilled(candidate, s.fieldValues)) {
        dispatch({ type: 'GUIDED_NAV', fieldId: candidate.id });
        return;
      }
    }
  }, []);

  const value = React.useMemo<SignerContextValue>(
    () => ({
      state,
      token,
      verify,
      goSigning,
      orderedUnfilled,
      guidedTotal: state.guidedTotal,
      signingError: state.signingError,
      signingPrev,
      signingNext,
      signingSkip,
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
      orderedUnfilled,
      signingPrev,
      signingNext,
      signingSkip,
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
