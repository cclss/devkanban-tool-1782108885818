'use client';

/**
 * Share recipient flow state machine + shared context.
 *
 * One share link drives a small client state machine:
 *
 *   loading ──▶ gate ──▶ viewing ──▶ done
 *      │          │
 *      │          └─(open link: auto-unlock, no gate)
 *      └─▶ blocked (expired | disabled | invalidLink | notSignable | alreadySubmitted)
 *
 * It mirrors the OTP signer machine (`signer-context`) but swaps the access gate
 * (a single password instead of a 6-digit code) and the endpoints (`/share/*`
 * instead of `/signing/*`). The reading / capture / completion experience is
 * identical, so this provider projects its state onto the flow-neutral
 * {@link FillContextValue} and wraps its children in a {@link FillProvider} — the
 * shared `document-viewer` / `signature-sheet` / `completion-screen` render the
 * recipient flow without any signer coupling. The OTP `/sign/[token]` flow is
 * left entirely untouched.
 */

import * as React from 'react';
import { ApiError } from '@/lib/api';
import { SIGNER_COPY } from '@/lib/signing';
import {
  fetchShareMeta,
  fetchSharePayload,
  getShareSession,
  saveShareFields,
  setShareSession,
  sharePdfUrl,
  submitShare,
  unlockShare,
  metaBlockReason,
  unlockBlockReason,
  SHARE_RECIPIENT_COPY,
  type ShareBlockReason,
  type ShareMeta,
  type SharePayload,
} from '@/lib/share-recipient';

export type { ShareBlockReason };
import {
  FillProvider,
  type FillCompletionFacts,
  type FillContextValue,
  type FillCopy,
  type FillFieldValue,
} from '@/components/signer/fill-context';

export type SharePhase = 'loading' | 'gate' | 'viewing' | 'done' | 'blocked';

export interface ShareState {
  phase: SharePhase;
  meta: ShareMeta | null;
  payload: SharePayload | null;
  blockReason: ShareBlockReason | null;
  fieldValues: Record<string, FillFieldValue>;
  activeFieldId: string | null;
  documentCompleted: boolean;
  /** Contract facts (date/amount/signedAt) echoed by `submit`; null until then. */
  completion: FillCompletionFacts | null;
}

const initialState: ShareState = {
  phase: 'loading',
  meta: null,
  payload: null,
  blockReason: null,
  fieldValues: {},
  activeFieldId: null,
  documentCompleted: false,
  completion: null,
};

type ShareAction =
  | { type: 'META'; meta: ShareMeta }
  | { type: 'BLOCK'; reason: ShareBlockReason }
  | { type: 'UNLOCKED'; payload: SharePayload }
  | { type: 'DONE'; documentCompleted: boolean; completion: FillCompletionFacts }
  | { type: 'OPEN_FIELD'; fieldId: string }
  | { type: 'CLOSE_FIELD' }
  | { type: 'SET_FIELD_VALUE'; fieldId: string; value: FillFieldValue };

function reducer(state: ShareState, action: ShareAction): ShareState {
  switch (action.type) {
    case 'META':
      if (action.meta.alreadySubmitted) {
        return { ...state, meta: action.meta, phase: 'blocked', blockReason: 'alreadySubmitted' };
      }
      // A password-protected link shows the gate; an open link stays on the
      // loading skeleton while it auto-unlocks.
      return {
        ...state,
        meta: action.meta,
        phase: action.meta.requiresPassword ? 'gate' : 'loading',
      };
    case 'BLOCK':
      return { ...state, phase: 'blocked', blockReason: action.reason };
    case 'UNLOCKED':
      return { ...state, phase: 'viewing', payload: action.payload };
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
        activeFieldId: state.activeFieldId === action.fieldId ? null : state.activeFieldId,
      };
    default:
      return state;
  }
}

interface ShareContextValue {
  state: ShareState;
  /** The LINK access token for this share link. */
  token: string;
  /**
   * Open the link: verify the password (when set), issue a share session, then
   * load the recipient's payload and advance to the viewer. A wrong/locked
   * password rejects with the server's Toss-tone message so the gate can shake +
   * surface it inline; an expired/invalid link transitions straight to its notice.
   */
  unlock: (password?: string) => Promise<void>;
}

const ShareContext = React.createContext<ShareContextValue | null>(null);

export function ShareProvider({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(reducer, initialState);

  const unlock = React.useCallback(
    async (password?: string) => {
      try {
        const { sessionToken } = await unlockShare(token, password);
        setShareSession(token, sessionToken);
        const payload = await fetchSharePayload(token, sessionToken);
        dispatch({ type: 'UNLOCKED', payload });
      } catch (error) {
        // Unambiguously terminal states resolve to their notice regardless of
        // where unlock was called from; retryable states (wrong/locked password)
        // propagate so the gate can surface them inline.
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 410) {
          dispatch({ type: 'BLOCK', reason: 'expired' });
          return;
        }
        if (status === 404) {
          dispatch({ type: 'BLOCK', reason: 'invalidLink' });
          return;
        }
        throw error;
      }
    },
    [token],
  );

  // Load pre-auth metadata once per link, then route to gate / auto-unlock / notice.
  React.useEffect(() => {
    let active = true;
    fetchShareMeta(token)
      .then((meta) => {
        if (!active) return;
        dispatch({ type: 'META', meta });
        // An open link (no password) unlocks immediately behind the skeleton.
        if (!meta.alreadySubmitted && !meta.requiresPassword) {
          unlock().catch((error) => {
            if (active) dispatch({ type: 'BLOCK', reason: unlockBlockReason(error) });
          });
        }
      })
      .catch((error) => {
        if (active) dispatch({ type: 'BLOCK', reason: metaBlockReason(error) });
      });
    return () => {
      active = false;
    };
  }, [token, unlock]);

  const openField = React.useCallback(
    (fieldId: string) => dispatch({ type: 'OPEN_FIELD', fieldId }),
    [],
  );
  const closeField = React.useCallback(() => dispatch({ type: 'CLOSE_FIELD' }), []);
  const setFieldValue = React.useCallback(
    (fieldId: string, value: FillFieldValue) =>
      dispatch({ type: 'SET_FIELD_VALUE', fieldId, value }),
    [],
  );

  const persistFields = React.useCallback(
    async (fields: { fieldId: string; value: string }[]) => {
      const session = getShareSession(token);
      if (!session) return;
      await saveShareFields(token, session, fields);
    },
    [token],
  );

  const complete = React.useCallback(async () => {
    const session = getShareSession(token);
    if (!session) {
      // A missing session means the unlock token expired or the tab lost it.
      throw new ApiError(SHARE_RECIPIENT_COPY.viewer.completeError, 401);
    }
    const result = await submitShare(token, session);
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

  const value = React.useMemo<ShareContextValue>(
    () => ({ state, token, unlock }),
    [state, token, unlock],
  );

  // Project the recipient state machine onto the flow-neutral fill surface.
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
      pdfUrl: sharePdfUrl(token),
      loadSession: () => getShareSession(token),
      persistFields,
      openField,
      closeField,
      setFieldValue,
      complete,
      copy: SHARE_FILL_COPY,
      // No download: a fill link has no completed artifact to hand back.
      // Present only after `submit` echoes the facts; the completion summary card
      // falls back to the title-only row until then.
      completion: state.completion ?? undefined,
    };
  }, [state, token, persistFields, openField, closeField, setFieldValue, complete]);

  return (
    <ShareContext.Provider value={value}>
      <FillProvider value={fillValue}>{children}</FillProvider>
    </ShareContext.Provider>
  );
}

export function useShare(): ShareContextValue {
  const ctx = React.useContext(ShareContext);
  if (!ctx) throw new Error('useShare must be used within a ShareProvider');
  return ctx;
}

/** The recipient flow's copy for the shared fill surface (speaks "작성/제출"). */
const SHARE_FILL_COPY: FillCopy = {
  ctaContinue: SHARE_RECIPIENT_COPY.viewer.ctaContinue,
  ctaComplete: SHARE_RECIPIENT_COPY.viewer.ctaComplete,
  loadError: SHARE_RECIPIENT_COPY.viewer.loadError,
  pageError: (n) => `${n}페이지를 불러올 수 없어요.`,
  progress: (total, done) => `작성할 항목 ${total}곳 중 ${done}곳을 작성했어요.`,
  progressCount: (done, total) => `작성 ${done}/${total} 완료`,
  progressNone: SHARE_RECIPIENT_COPY.viewer.progressNone,
  progressAllDone: SHARE_RECIPIENT_COPY.viewer.progressAllDone,
  // The capture affordance + sheet chrome are identical to the signer flow.
  fieldAffordance: SIGNER_COPY.fieldAffordance,
  completeError: SHARE_RECIPIENT_COPY.viewer.completeError,
  sheet: {
    ...SIGNER_COPY.sheet,
    hint: (type) => {
      if (type === 'DATE') return '날짜를 입력해 주세요.';
      if (type === 'TEXT') return '내용을 입력해 주세요.';
      return SIGNER_COPY.sheet.drawHint;
    },
  },
  document: {
    sectionTitle: SHARE_RECIPIENT_COPY.viewer.docTitle,
    hint: SHARE_RECIPIENT_COPY.viewer.docHint,
    expand: SHARE_RECIPIENT_COPY.viewer.docExpand,
    collapse: SHARE_RECIPIENT_COPY.viewer.docCollapse,
  },
  done: {
    title: SHARE_RECIPIENT_COPY.done.title,
    body: SHARE_RECIPIENT_COPY.done.body,
    documentLabel: SHARE_RECIPIENT_COPY.done.documentLabel,
    dateLabel: SHARE_RECIPIENT_COPY.done.dateLabel,
    amountLabel: SHARE_RECIPIENT_COPY.done.amountLabel,
    signedAtLabel: SHARE_RECIPIENT_COPY.done.signedAtLabel,
    // A share submission shows one next-step line regardless of other participants.
    nextAllDone: SHARE_RECIPIENT_COPY.done.next,
    nextWaiting: SHARE_RECIPIENT_COPY.done.next,
    // Type-completeness only: the share flow projects no highlights, so the recap
    // (and this heading) never render.
    summaryLabel: SHARE_RECIPIENT_COPY.done.documentLabel,
  },
};
