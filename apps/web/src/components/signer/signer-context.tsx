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
  fetchMeta,
  fetchPayload,
  setSignerSession,
  verifyCode,
  type SigningMeta,
  type SigningPayload,
} from '@/lib/signing';

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
  /** Why a link is non-signable, when `phase === 'blocked'`. */
  blockReason: BlockReason | null;
}

const initialState: SignerState = {
  phase: 'loading',
  meta: null,
  payload: null,
  blockReason: null,
};

type SignerAction =
  | { type: 'META_OK'; meta: SigningMeta }
  | { type: 'BLOCK'; reason: BlockReason; meta: SigningMeta | null }
  | { type: 'VERIFIED'; payload: SigningPayload }
  | { type: 'GO_SIGNING' }
  | { type: 'DONE' };

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
      return { ...state, phase: 'done' };
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
  /**
   * Verify the 6-digit code, then load the signer's payload and advance to the
   * viewer. Rejects (with the server's Toss-tone message) on a wrong/expired
   * code so the screen can shake + reset without leaving `verify`.
   */
  verify: (code: string) => Promise<void>;
  /** Advance from the viewer into the signature step (later grains). */
  goSigning: () => void;
  /** Mark the signer's part complete (later grains). */
  markDone: () => void;
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
  const markDone = React.useCallback(() => dispatch({ type: 'DONE' }), []);

  const value = React.useMemo<SignerContextValue>(
    () => ({ state, verify, goSigning, markDone }),
    [state, verify, goSigning, markDone],
  );

  return <SignerContext.Provider value={value}>{children}</SignerContext.Provider>;
}

export function useSigner(): SignerContextValue {
  const ctx = React.useContext(SignerContext);
  if (!ctx) throw new Error('useSigner must be used within a SignerProvider');
  return ctx;
}
