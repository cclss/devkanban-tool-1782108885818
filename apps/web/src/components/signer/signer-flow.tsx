'use client';

/**
 * SignerFlow — renders the screen for the current state-machine phase.
 *
 * Reads phase off the shared signer context and dispatches to the matching
 * screen. The happy path (loading → verify → clauses → viewing → signing →
 * done) plus the `blocked` branch are all covered here. `clauses` renders the
 * AI key-clause reminder (only when READY cards exist; otherwise verify skips
 * straight to `viewing`). `viewing` / `signing` render the document viewer (the
 * capture sheet overlays it); `done` shows the completion screen.
 */

import * as React from 'react';
import { useSigner } from './signer-context';
import { LoadingScreen } from './loading-screen';
import { VerifyScreen } from './verify-screen';
import { NoticeScreen } from './notice-screen';
import { ClauseCardScreen } from './clause-card-screen';
import { DocumentViewer } from './document-viewer';
import { CompletionScreen } from './completion-screen';

export function SignerFlow() {
  const { state } = useSigner();

  switch (state.phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'verify':
      // Meta is guaranteed present once we leave loading for verify.
      return state.meta ? <VerifyScreen meta={state.meta} /> : <LoadingScreen />;
    case 'blocked':
      return (
        <NoticeScreen reason={state.blockReason ?? 'invalidLink'} meta={state.meta} />
      );
    case 'clauses':
      return state.meta ? <ClauseCardScreen meta={state.meta} /> : <LoadingScreen />;
    case 'viewing':
    case 'signing':
      return state.meta ? <DocumentViewer meta={state.meta} /> : <LoadingScreen />;
    case 'done':
      return state.meta ? <CompletionScreen meta={state.meta} /> : <LoadingScreen />;
    default:
      return <LoadingScreen />;
  }
}
