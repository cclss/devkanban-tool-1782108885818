'use client';

/**
 * SignerFlow — renders the screen for the current state-machine phase.
 *
 * Reads phase off the shared signer context and dispatches to the matching
 * screen. The five-phase happy path (loading → verify → viewing → signing →
 * done) plus the `blocked` branch are all covered here. `viewing` / `signing`
 * render the shared document viewer; `done` the shared completion screen — both
 * read the OTP flow's projection through the FillProvider mounted by
 * `SignerProvider`.
 */

import * as React from 'react';
import { SIGNER_COPY } from '@/lib/signing';
import { useSigner, type BlockReason } from './signer-context';
import { LoadingScreen } from './loading-screen';
import { VerifyScreen } from './verify-screen';
import { NoticeScreen, type NoticeScreenProps } from './notice-screen';
import { DocumentViewer } from './document-viewer';
import { CompletionScreen } from './completion-screen';

/** Terminal copy + tone for each non-signable reason (Toss voice, no blame). */
const NOTICE: Record<BlockReason, { title: string; body: string; tone: NoticeScreenProps['tone'] }> = {
  alreadySigned: {
    title: SIGNER_COPY.alreadySignedTitle,
    body: SIGNER_COPY.alreadySigned,
    tone: 'success',
  },
  unavailable: {
    title: SIGNER_COPY.unavailableTitle,
    body: SIGNER_COPY.unavailable,
    tone: 'neutral',
  },
  invalidLink: {
    title: SIGNER_COPY.invalidLinkTitle,
    body: SIGNER_COPY.invalidLink,
    tone: 'neutral',
  },
};

export function SignerFlow() {
  const { state } = useSigner();

  switch (state.phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'verify':
      // Meta is guaranteed present once we leave loading for verify.
      return state.meta ? <VerifyScreen meta={state.meta} /> : <LoadingScreen />;
    case 'blocked': {
      const notice = NOTICE[state.blockReason ?? 'invalidLink'];
      return (
        <NoticeScreen
          title={notice.title}
          body={notice.body}
          tone={notice.tone}
          sender={state.meta?.sender ?? null}
          brandColor={state.meta?.sender.brandColor ?? null}
        />
      );
    }
    case 'viewing':
    case 'signing':
      return state.meta ? <DocumentViewer /> : <LoadingScreen />;
    case 'done':
      return state.meta ? <CompletionScreen /> : <LoadingScreen />;
    default:
      return <LoadingScreen />;
  }
}
