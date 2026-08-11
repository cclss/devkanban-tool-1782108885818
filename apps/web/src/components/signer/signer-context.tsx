'use client';

/**
 * Signer flow state machine + shared context.
 *
 * One signing link drives a small client state machine:
 *
 *   loading ──▶ verify ──▶ viewing ──▶ signing ──▶ done
 *      │           ▲          │
 *      │           └──────────┴─▶ expired (session 401) ──▶ verify (re-auth)
 *      └─▶ blocked (invalidLink | alreadySigned | unavailable)
 *
 * The happy path is the five-phase line from the brief; non-signable links
 * branch to a friendly `blocked` terminal with a reason. A session-guarded call
 * that 401s (the ~30-minute signer session lapsed) routes to `expired`, which
 * offers a re-auth CTA back to `verify`. This grain (grain-2)
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
  clearSignerSession,
  completeSigning,
  downloadSignerArtifact,
  fetchMeta,
  fetchPayload,
  getSignerSession,
  isSessionExpiredError,
  saveFields,
  setSignerSession,
  signerPdfUrl,
  verifyCode,
  SIGNER_COPY,
  type SigningMeta,
  type SigningPayload,
} from '@/lib/signing';
import {
  FillProvider,
  type FillContextValue,
  type FillCopy,
  type FillFieldValue,
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
  | 'expired'
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
  /** The re-auth notice's body when `phase === 'expired'` (server's expiry copy). */
  expiredMessage: string | null;
}

const initialState: SignerState = {
  phase: 'loading',
  meta: null,
  payload: null,
  blockReason: null,
  fieldValues: {},
  activeFieldId: null,
  documentCompleted: false,
  expiredMessage: null,
};

type SignerAction =
  | { type: 'META_OK'; meta: SigningMeta }
  | { type: 'BLOCK'; reason: BlockReason; meta: SigningMeta | null }
  | { type: 'VERIFIED'; payload: SigningPayload }
  | { type: 'GO_SIGNING' }
  | { type: 'DONE'; documentCompleted: boolean }
  | { type: 'EXPIRE'; message: string }
  | { type: 'REAUTH' }
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
      return { ...state, phase: 'viewing', payload: action.payload };
    case 'GO_SIGNING':
      return { ...state, phase: 'signing' };
    case 'DONE':
      return { ...state, phase: 'done', documentCompleted: action.documentCompleted };
    case 'EXPIRE':
      // The session lapsed mid-flow: drop the now-stale working set and show the
      // re-auth notice. `meta` is kept so re-verify lands on the same document.
      return {
        ...state,
        phase: 'expired',
        expiredMessage: action.message,
        payload: null,
        fieldValues: {},
        activeFieldId: null,
      };
    case 'REAUTH':
      // Back to the code entry; a fresh verify re-fetches the payload (with any
      // server-persisted values), returning the signer to where they were.
      return {
        ...state,
        phase: 'verify',
        expiredMessage: null,
        payload: null,
        fieldValues: {},
        activeFieldId: null,
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
  /**
   * Leave the `expired` notice and return to code entry so the signer can
   * re-verify; a fresh verify reloads the payload and drops them back into the
   * flow. No-op unless `phase === 'expired'`.
   */
  reauth: () => void;
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
    },
    [token],
  );

  const goSigning = React.useCallback(() => dispatch({ type: 'GO_SIGNING' }), []);

  // Any session-guarded call can 401 once the ~30-minute signer session lapses.
  // Catch it centrally: clear the dead session and route to the re-auth notice,
  // then re-throw so the calling screen stops treating the call as a success.
  const guardExpiry = React.useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (error) {
        if (isSessionExpiredError(error)) {
          clearSignerSession(token);
          dispatch({
            type: 'EXPIRE',
            message:
              error instanceof ApiError ? error.message : SIGNER_COPY.sessionExpired,
          });
        }
        throw error;
      }
    },
    [token],
  );

  const reauth = React.useCallback(() => dispatch({ type: 'REAUTH' }), []);

  // The reading path (PDF stream) 401s or has no session: project it through the
  // same `guardExpiry` contract as save/complete so the tone is identical — clear
  // the dead session and dispatch `EXPIRE` with the mirrored expiry copy. The
  // 401 is synthesized here because the fetch already happened in the viewer.
  const onSessionExpired = React.useCallback(() => {
    void guardExpiry(async () => {
      throw new ApiError(SIGNER_COPY.sessionExpired, 401);
    }).catch(() => {
      // guardExpiry has already routed to the re-auth notice; the re-throw is
      // expected and carries no further action for the reading path.
    });
  }, [guardExpiry]);

  const complete = React.useCallback(
    () =>
      guardExpiry(async () => {
        const session = getSignerSession(token);
        if (!session) {
          // A missing session means it expired or the tab lost it: synthesize the
          // same 401 so the signer re-verifies instead of hitting a dead-end retry.
          throw new ApiError(SIGNER_COPY.sessionExpired, 401);
        }
        const result = await completeSigning(token, session);
        dispatch({ type: 'DONE', documentCompleted: result.documentCompleted });
      }),
    [token, guardExpiry],
  );
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
    () => ({ state, token, verify, goSigning, complete, reauth, openField, closeField, setFieldValue }),
    [state, token, verify, goSigning, complete, reauth, openField, closeField, setFieldValue],
  );

  // Persist captured values to the signer's `fields` endpoint. A 401 (or a lost
  // session) routes to the re-auth notice via `guardExpiry` rather than failing
  // silently, matching the finalize path.
  const persistFields = React.useCallback(
    (fields: { fieldId: string; value: string }[]) =>
      guardExpiry(async () => {
        const session = getSignerSession(token);
        if (!session) throw new ApiError(SIGNER_COPY.sessionExpired, 401);
        await saveFields(token, session, fields);
      }),
    [token, guardExpiry],
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
      onSessionExpired,
      download: {
        onDownload: (kind) => downloadSignerArtifact(token, kind, documentTitle),
      },
    };
  }, [state, token, persistFields, openField, closeField, setFieldValue, complete, onSessionExpired]);

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
  done: SIGNER_COPY.done,
};

export function useSigner(): SignerContextValue {
  const ctx = React.useContext(SignerContext);
  if (!ctx) throw new Error('useSigner must be used within a SignerProvider');
  return ctx;
}
