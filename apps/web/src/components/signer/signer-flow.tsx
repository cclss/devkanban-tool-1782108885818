'use client';

/**
 * SignerFlow — renders the screen for the current state-machine phase.
 *
 * Reads phase off the shared signer context and dispatches to the matching
 * screen. The five-phase happy path (loading → verify → viewing → signing →
 * done) plus the `blocked` branch are all covered here. `viewing` / `signing`
 * render the document viewer (the capture sheet overlays it); `done` reuses the
 * viewer until the completion screen grain builds it out.
 */

import * as React from 'react';
import { useSigner } from './signer-context';
import { LoadingScreen } from './loading-screen';
import { VerifyScreen } from './verify-screen';
import { NoticeScreen } from './notice-screen';
import { DocumentViewer } from './document-viewer';

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
    case 'viewing':
    case 'signing':
    case 'done':
      return state.meta ? <DocumentViewer meta={state.meta} /> : <LoadingScreen />;
    default:
      return <LoadingScreen />;
  }
}
