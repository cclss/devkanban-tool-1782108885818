'use client';

/**
 * ShareFlow — renders the screen for the recipient state-machine phase.
 *
 * Reads phase off the share context and dispatches to the matching screen. The
 * happy path (loading → gate → viewing → done) reuses the signer flow's shared
 * surfaces (loading skeleton, document viewer, completion takeover) through the
 * FillProvider mounted by `ShareProvider`; only the access gate
 * (`PasswordGate`) differs. Non-openable links branch to a calm `NoticeScreen`.
 */

import * as React from 'react';
import { LoadingScreen } from '@/components/signer/loading-screen';
import { DocumentViewer } from '@/components/signer/document-viewer';
import { CompletionScreen } from '@/components/signer/completion-screen';
import { NoticeScreen } from '@/components/signer/notice-screen';
import { shareRecipientCopyFor } from '@/lib/share-recipient';
import { useLocale } from '@/components/locale-provider';
import { useShare } from './share-context';
import { PasswordGate } from './password-gate';

export function ShareFlow() {
  const { state } = useShare();
  const { locale } = useLocale();
  const copy = shareRecipientCopyFor(locale);

  switch (state.phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'gate':
      return state.meta ? <PasswordGate meta={state.meta} /> : <LoadingScreen />;
    case 'blocked': {
      const reason = state.blockReason ?? 'invalidLink';
      const notice = {
        ...copy.notice[reason],
        tone: reason === 'alreadySubmitted' ? 'success' as const : 'neutral' as const,
      };
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
      return <DocumentViewer />;
    case 'done':
      return <CompletionScreen />;
    default:
      return <LoadingScreen />;
  }
}
