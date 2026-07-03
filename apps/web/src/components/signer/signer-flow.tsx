'use client';

/**
 * SignerFlow — renders the screen for the current state-machine phase.
 *
 * Reads phase off the shared signer context and dispatches to the matching
 * screen. The happy path (loading → verify → clauses → viewing → signing →
 * done) plus the `blocked` branch are all covered here. `clauses` renders the
 * AI key-clause reminder (only when READY cards exist; otherwise verify skips
 * straight to `viewing`, the first-class full-PDF fallback — not a degraded
 * state). `viewing` / `signing` render the same document viewer (the capture
 * sheet overlays it); `done` shows the completion screen.
 *
 * A single persistent `aria-live="polite"` region sits above the phase screen
 * and narrates each step the signer just reached (`SIGNER_COPY.flowStep`, flow
 * integration). The visual chrome already swaps per phase; this voices the
 * transition so non-visual users can track their place across the whole flow —
 * including the card ↔ full-PDF-fallback fork, which both carry an announcement.
 */

import * as React from 'react';
import { SIGNER_COPY } from '@/lib/signing';
import { useSigner, type SignerPhase } from './signer-context';
import { LoadingScreen } from './loading-screen';
import { VerifyScreen } from './verify-screen';
import { NoticeScreen } from './notice-screen';
import { ClauseCardScreen } from './clause-card-screen';
import { DocumentViewer } from './document-viewer';
import { CompletionScreen } from './completion-screen';

/**
 * The screen for the current phase. Kept as a plain switch (no state mutation)
 * so `SignerFlow` can wrap it with the shared step-announcement live region.
 */
function PhaseScreen({ state }: { state: ReturnType<typeof useSigner>['state'] }) {
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

/**
 * The step-transition line for screen readers, or '' where none applies.
 * `loading` is pre-flow and `blocked` is a self-describing terminal notice, so
 * neither announces a step; every other phase maps 1:1 to `flowStep`. Narrowing
 * inside the case block lets `flowStep[phase]` type-check without a cast.
 */
function stepAnnouncement(phase: SignerPhase): string {
  switch (phase) {
    case 'verify':
    case 'clauses':
    case 'viewing':
    case 'signing':
    case 'done':
      return SIGNER_COPY.flowStep[phase];
    default:
      return '';
  }
}

export function SignerFlow() {
  const { state } = useSigner();

  return (
    <>
      {/*
        Persistent (never keyed/remounted) polite live region: its text changes
        as the state machine advances, and that text change is what the screen
        reader announces — the same pattern the signature sheet uses for its
        per-field beats. Rendering it once, outside the phase switch, keeps the
        announcement from being torn down together with the screen it describes.
      */}
      <p className="sr-only" aria-live="polite">
        {stepAnnouncement(state.phase)}
      </p>
      <PhaseScreen state={state} />
    </>
  );
}
