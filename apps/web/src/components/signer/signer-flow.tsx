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
import { signerCopyFor } from '@/lib/signing';
import { useLocale } from '@/components/locale-provider';
import { useSigner, type BlockReason } from './signer-context';
import { LoadingScreen } from './loading-screen';
import { VerifyScreen } from './verify-screen';
import { NoticeScreen, type NoticeScreenProps } from './notice-screen';
import { DocumentViewer } from './document-viewer';
import { CompletionScreen } from './completion-screen';

/** Terminal copy + tone for each non-signable reason (Toss voice, no blame). */
export function SignerFlow() {
  const { state } = useSigner();
  const { locale } = useLocale();
  const copy = signerCopyFor(locale);
  const notice: Record<BlockReason, { title: string; body: string; tone: NoticeScreenProps['tone'] }> = {
    alreadySigned: { title: copy.alreadySignedTitle, body: copy.alreadySigned, tone: 'success' },
    unavailable: { title: copy.unavailableTitle, body: copy.unavailable, tone: 'neutral' },
    invalidLink: { title: copy.invalidLinkTitle, body: copy.invalidLink, tone: 'neutral' },
  };

  switch (state.phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'verify':
      // Meta is guaranteed present once we leave loading for verify.
      return state.meta ? <VerifyScreen meta={state.meta} /> : <LoadingScreen />;
    case 'blocked': {
      const currentNotice = notice[state.blockReason ?? 'invalidLink'];
      return (
        <NoticeScreen
          title={currentNotice.title}
          body={currentNotice.body}
          tone={currentNotice.tone}
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
