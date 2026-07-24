'use client';

/**
 * Signer flow state machine + shared context.
 *
 * One signing link drives a small client state machine:
 *
 *   loading ──▶ verify ──▶ viewing ──▶ signing ──▶ done
 *      │
 *      └─▶ blocked (invalidLink | alreadySigned | unavailable)
 *
 * The happy path is the five-phase line from the brief; non-signable links
 * branch to a friendly `blocked` terminal with a reason. This grain (grain-2)
 * drives transitions up to `viewing` (a placeholder); later grains own the
 * PDF viewer, signature capture (`signing`) and the completion screen (`done`),
 * binding to the `payload` + `session` this context already holds.
 *
 * The shell owns chrome and routing-free state; steps read state and dispatch
 * intent (`verify`), never mutating phase directly — mirroring the sender
 * wizard's centralized-navigation contract.
 */

import * as React from 'react';
import { ApiError } from '@/lib/api';
import {
  completeSigning,
  downloadSignerArtifact,
  fetchHighlights,
  fetchMeta,
  fetchPayload,
  getSignerSession,
  saveFields,
  seedFieldValues,
  setSignerSession,
  signerPdfUrl,
  verifyCode,
  SIGNER_COPY,
  type HighlightsResult,
  type SigningMeta,
  type SigningPayload,
} from '@/lib/signing';
import {
  FillProvider,
  type FillCompletionFacts,
  type FillContextValue,
  type FillCopy,
  type FillFieldValue,
  type FillHighlightsCopy,
} from './fill-context';

/**
 * A value the signer has captured for one field, read back by the viewer to
 * reflect it inline on the page. Identical to the flow-neutral
 * {@link FillFieldValue} (the capture surface is shared by the share flow).
 */
export type SignerFieldValue = FillFieldValue;

export type SignerPhase =
  | 'loading'
  | 'verify'
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
  /**
   * Pre-read key-clause summary, fetched (non-blocking) after verify. `null`
   * while in flight; a resolved `{ available:false }` degrades gracefully.
   */
  highlights: HighlightsResult | null;
  /** Why a link is non-signable, when `phase === 'blocked'`. */
  blockReason: BlockReason | null;
  /** Values captured per field id; the viewer reflects these inline. */
  fieldValues: Record<string, SignerFieldValue>;
  /** The field whose capture sheet is open (drives the BottomSheet target). */
  activeFieldId: string | null;
  /** Set once `complete` succeeds: whether the whole document is now finalized. */
  documentCompleted: boolean;
  /** Contract facts (date/amount/signedAt) echoed by `complete`; null until then. */
  completion: FillCompletionFacts | null;
}

const initialState: SignerState = {
  phase: 'loading',
  meta: null,
  payload: null,
  highlights: null,
  blockReason: null,
  fieldValues: {},
  activeFieldId: null,
  documentCompleted: false,
  completion: null,
};

type SignerAction =
  | { type: 'META_OK'; meta: SigningMeta }
  | { type: 'BLOCK'; reason: BlockReason; meta: SigningMeta | null }
  | { type: 'VERIFIED'; payload: SigningPayload }
  | { type: 'HIGHLIGHTS'; highlights: HighlightsResult }
  | { type: 'GO_SIGNING' }
  | { type: 'DONE'; documentCompleted: boolean; completion: FillCompletionFacts }
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
    case 'VERIFIED':
      return {
        ...state,
        phase: 'viewing',
        payload: action.payload,
        // Rehydrate any server-persisted values so a resumed session shows the
        // real signature/text/date rather than a "작성됨" placeholder.
        fieldValues: seedFieldValues(action.payload.fields),
      };
    case 'HIGHLIGHTS':
      return { ...state, highlights: action.highlights };
    case 'GO_SIGNING':
      return { ...state, phase: 'signing' };
    case 'DONE':
      return {
        ...state,
        phase: 'done',
        documentCompleted: action.documentCompleted,
        completion: action.completion,
      };
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
  /** Advance from the viewer into the signature step (later grains). */
  goSigning: () => void;
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
      dispatch({ type: 'VERIFIED', payload });
      // Load the pre-read summary in the background — additive, never blocks the
      // viewer. Any failure degrades to a graceful "couldn't summarize" fallback.
      fetchHighlights(token, sessionToken)
        .then((highlights) => dispatch({ type: 'HIGHLIGHTS', highlights }))
        .catch(() =>
          dispatch({ type: 'HIGHLIGHTS', highlights: { available: false, clauses: [] } }),
        );
    },
    [token],
  );

  const goSigning = React.useCallback(() => dispatch({ type: 'GO_SIGNING' }), []);
  const complete = React.useCallback(async () => {
    const session = getSignerSession(token);
    if (!session) {
      // The session is required to finalize; a missing one means it expired or
      // the tab lost it. Surface a neutral error so the viewer offers a retry.
      throw new ApiError(SIGNER_COPY.completeError, 401);
    }
    const result = await completeSigning(token, session);
    dispatch({
      type: 'DONE',
      documentCompleted: result.documentCompleted,
      completion: {
        signedAt: result.signedAt,
        contractDate: result.contractDate,
        contractAmount: result.contractAmount,
      },
    });
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
    () => ({ state, token, verify, goSigning, complete, openField, closeField, setFieldValue }),
    [state, token, verify, goSigning, complete, openField, closeField, setFieldValue],
  );

  // Persist captured values to the signer's `fields` endpoint (a missing session
  // is a no-op; the value still lives in memory for the active flow).
  const persistFields = React.useCallback(
    async (fields: { fieldId: string; value: string }[]) => {
      const session = getSignerSession(token);
      if (!session) return;
      await saveFields(token, session, fields);
    },
    [token],
  );

  // Project the signer state machine onto the flow-neutral fill surface so the
  // shared viewer / capture sheet / completion screen render the OTP flow.
  const fillValue = React.useMemo<FillContextValue>(() => {
    const documentTitle = state.payload?.documentTitle ?? state.meta?.documentTitle ?? '';
    return {
      sender: state.meta?.sender ?? { name: null, brandColor: null, brandLogoUrl: null },
      brandColor: state.meta?.sender.brandColor ?? null,
      documentTitle,
      payload: state.payload
        ? {
            documentTitle: state.payload.documentTitle,
            pageCount: state.payload.pageCount,
            fields: state.payload.fields,
          }
        : null,
      fieldValues: state.fieldValues,
      activeFieldId: state.activeFieldId,
      documentCompleted: state.documentCompleted,
      pdfUrl: signerPdfUrl(token),
      loadSession: () => getSignerSession(token),
      persistFields,
      openField,
      closeField,
      setFieldValue,
      complete,
      copy: SIGNER_FILL_COPY,
      // Project the pre-read summary once verified: `null` while its background
      // fetch is in flight, the bundle (+ client chrome) once it resolves.
      highlights: state.payload
        ? state.highlights
          ? {
              available: state.highlights.available,
              clauses: state.highlights.clauses,
              copy: SIGNER_HIGHLIGHTS_COPY,
            }
          : null
        : undefined,
      download: {
        onDownload: (kind) => downloadSignerArtifact(token, kind, documentTitle),
      },
      // Present only after `complete` echoes the facts; the completion summary
      // card falls back to the title-only row until then.
      completion: state.completion ?? undefined,
    };
  }, [state, token, persistFields, openField, closeField, setFieldValue, complete]);

  return (
    <SignerContext.Provider value={value}>
      <FillProvider value={fillValue}>{children}</FillProvider>
    </SignerContext.Provider>
  );
}

/** The OTP signer flow's copy for the shared fill surface (speaks "서명"). */
const SIGNER_FILL_COPY: FillCopy = {
  ctaContinue: SIGNER_COPY.viewerCtaContinue,
  ctaComplete: SIGNER_COPY.viewerCtaComplete,
  loadError: SIGNER_COPY.viewerLoadError,
  pageError: (n) => `${n}페이지를 불러올 수 없어요.`,
  progress: (total, done) => `서명할 항목 ${total}곳 중 ${done}곳을 작성했어요.`,
  progressCount: (done, total) => `서명 ${done}/${total} 완료`,
  progressNone: '서명할 항목이 없어요.',
  progressAllDone: '모든 항목을 작성했어요.',
  fieldAffordance: SIGNER_COPY.fieldAffordance,
  completeError: SIGNER_COPY.completeError,
  sheet: {
    ...SIGNER_COPY.sheet,
    hint: (type) => {
      if (type === 'DATE') return '서명한 날짜를 입력해 주세요.';
      if (type === 'TEXT') return '필요한 내용을 입력해 주세요.';
      return SIGNER_COPY.sheet.drawHint;
    },
  },
  document: {
    sectionTitle: SIGNER_COPY.viewerDocTitle,
    hint: SIGNER_COPY.viewerDocHint,
    expand: SIGNER_COPY.viewerDocExpand,
    collapse: SIGNER_COPY.viewerDocCollapse,
  },
  done: SIGNER_COPY.done,
};

/** Client-owned chrome for the signer's key-clause summary (content is server-owned). */
const SIGNER_HIGHLIGHTS_COPY: FillHighlightsCopy = {
  sectionTitle: SIGNER_COPY.summary.sectionTitle,
  sectionHint: SIGNER_COPY.summary.sectionHint,
  categoryLabel: SIGNER_COPY.summary.categoryLabel,
  sourceLink: SIGNER_COPY.summary.sourceLink,
  unavailable: SIGNER_COPY.summary.unavailable,
};

export function useSigner(): SignerContextValue {
  const ctx = React.useContext(SignerContext);
  if (!ctx) throw new Error('useSigner must be used within a SignerProvider');
  return ctx;
}
