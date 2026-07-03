'use client';

/**
 * CompletionScreen — the signer's celebratory finish.
 *
 * Shown once the bottom CTA's `complete` call succeeds (phase `done`). A
 * full-viewport takeover owns the moment: the SuccessCheck ring/tick stroke-draw
 * with a Confetti burst fanning out of the mark, then the text fades in staggered
 * (headline → body → contract summary → what-happens-next → download) via the
 * `motion-stagger` token. A calm summary card recaps what was just signed — the
 * document name, the signed-at time (`signedAt`, formatted KST), and the AI
 * key-clause recap (when the send-time extraction is `READY`) — before pointing to
 * the mailed copy. No further action is required of the signer.
 *
 * The overlay is a scroll-safe centering container (`overflow-y-auto` + an
 * `m-auto` inner wrapper, `completion-download.md` 결정9): it centers when there's
 * room and lets both ends scroll into reach when the summary + download card grow
 * past a short/landscape viewport, so the bottom download CTA never clips.
 *
 * Rendered through a portal to <body> so no transformed/over­flow-clipped ancestor
 * can trap the fixed overlay; the brand hook is re-applied on the overlay itself
 * (it escapes the viewer's branded subtree). Under reduced-motion the global
 * fallback collapses every animation to its static end-state: the check is fully
 * drawn, the confetti stays invisible, and the staggered text is simply present.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Confetti, SuccessCheck } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { CompletionDownload } from '@/components/completion-download';
import { formatKstDateTime } from '@/lib/completion-download';
import {
  SIGNER_COPY,
  downloadSignerArtifact,
  type ClauseCard,
  type SigningMeta,
} from '@/lib/signing';
import { useSigner } from './signer-context';

const DONE_COPY = SIGNER_COPY.done;
const CLAUSE_COPY = SIGNER_COPY.clause;

export function CompletionScreen({ meta }: { meta: SigningMeta }) {
  const { state, token } = useSigner();
  const { payload, documentCompleted, signedAt, clauses, clauseStatus } = state;

  // Portals need the DOM; gate on mount so SSR/first paint stays clean.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const documentTitle = payload?.documentTitle ?? meta.documentTitle;
  const nextStep = documentCompleted
    ? DONE_COPY.nextAllDone
    : DONE_COPY.nextWaiting;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={DONE_COPY.title}
      style={{
        ...brandStyle(meta.sender.brandColor),
        // Safe-area aware: keep clear of notch/home-indicator on mobile. (This
        // branch has no `.pt-safe`/`.pb-safe` utils, so the inline env padding is
        // the realized convention — see grain-3 audit open item.)
        paddingTop: 'max(env(safe-area-inset-top), 24px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
      }}
      className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-background px-lg text-center"
    >
      {/*
        Scroll-safe centering wrapper (결정9): `m-auto` centers when the viewport
        has room and collapses its margins to let the content scroll (both ends
        reachable) when the summary + download card overflow a short screen.
        Owns `max-w-[420px]` (완료 블록 상한 폭, 결정2) + the `gap-xl` rhythm.
      */}
      <div className="m-auto flex w-full max-w-[420px] flex-col items-center gap-xl">
        <div className="relative flex items-center justify-center">
          <Confetti className="z-0" />
          <SuccessCheck size={104} className="relative z-10" aria-label={DONE_COPY.title} />
        </div>

        <div className="motion-stagger flex w-full flex-col items-center gap-sm">
          <h1 className="text-2xl font-bold text-foreground">{DONE_COPY.title}</h1>
          <p className="text-base text-foreground-subtle">{DONE_COPY.body}</p>

          <ContractSummaryCard
            documentTitle={documentTitle}
            signedAt={signedAt}
            clauses={clauses}
            clauseReady={clauseStatus === 'READY'}
          />

          <p className="mt-xs text-sm text-foreground-subtle">{nextStep}</p>

          {documentCompleted ? (
            <CompletionDownload
              className="mt-xs w-full rounded-md border border-border bg-surface px-md py-md"
              ready
              showBadge={false}
              completedAt={signedAt}
              onDownload={(kind) => downloadSignerArtifact(token, kind, documentTitle)}
            />
          ) : null}
        </div>
      </div>
    </div>,
    window.document.body,
  );
}

/**
 * The just-signed contract summary — one calm card recapping what was signed.
 * Always names the document + signed-at time; the AI key-clause recap is appended
 * only when the send-time extraction is `READY` with cards (otherwise the card
 * degrades gracefully to name + time, the viewing/EMPTY/FAILED fallback). One
 * `motion-stagger` child, so it fades in as a single unit.
 */
function ContractSummaryCard({
  documentTitle,
  signedAt,
  clauses,
  clauseReady,
}: {
  documentTitle: string;
  signedAt: string | null;
  clauses: ClauseCard[] | null;
  clauseReady: boolean;
}) {
  const signedAtLabel = formatKstDateTime(signedAt);
  const recapClauses = clauseReady && clauses && clauses.length > 0 ? clauses : null;
  // Associate the AI-summary advisory with the card region for screen readers.
  const advisoryId = React.useId();

  return (
    <section
      aria-label={DONE_COPY.summaryLabel}
      aria-describedby={recapClauses ? advisoryId : undefined}
      className="mt-xs w-full rounded-md border border-border bg-surface-muted px-md py-md text-left"
    >
      <dl className="flex flex-col gap-sm">
        <div>
          <dt className="text-2xs font-medium text-foreground-subtle">
            {DONE_COPY.documentLabel}
          </dt>
          <dd className="mt-2xs truncate text-sm font-semibold text-foreground">
            {documentTitle}
          </dd>
        </div>

        {signedAtLabel ? (
          <div>
            <dt className="text-2xs font-medium text-foreground-subtle">
              {DONE_COPY.signedAtLabel}
            </dt>
            <dd className="mt-2xs text-sm font-semibold text-foreground">{signedAtLabel}</dd>
          </div>
        ) : null}
      </dl>

      {recapClauses ? (
        <div className="mt-md border-t border-border pt-md">
          <p className="text-2xs font-medium text-foreground-subtle">{DONE_COPY.clausesLabel}</p>
          <ul className="mt-sm flex flex-col gap-sm">
            {recapClauses.map((clause, i) => (
              <li key={`${clause.sourcePage}-${i}`}>
                <ClauseRecap clause={clause} />
              </li>
            ))}
          </ul>
          {/* AI-summary advisory (grain-2 one-liner) — reference aid; legal
              effect stays with the source document. Single source: `clause`. */}
          <p id={advisoryId} className="mt-sm text-2xs text-foreground-muted">
            {CLAUSE_COPY.advisoryNotice}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** One compact clause recap: title, optional caution badge + reason, summary. */
function ClauseRecap({ clause }: { clause: ClauseCard }) {
  return (
    <div className="flex flex-col gap-2xs">
      <div className="flex items-start justify-between gap-xs">
        <p className="text-sm font-semibold text-foreground">{clause.title}</p>
        {clause.caution ? <CautionBadge /> : null}
      </div>
      <p className="text-sm text-foreground-subtle">{clause.summary}</p>
      {clause.caution && clause.cautionReason ? (
        // Reuses the clause-card-screen caution notation (warning-subtle tint,
        // server-owned reason surfaced verbatim) — worth a second look, not alarm.
        <p className="rounded-sm bg-warning-subtle px-sm py-xs text-2xs text-foreground-muted">
          {clause.cautionReason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * '주의' badge for a caution clause — reuses the `clause-card-screen.tsx` notation
 * convention (colored dot on a subtle tint, dark label; color is never the only
 * signal since the '주의' label is always present).
 */
function CautionBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2xs rounded-full bg-warning-subtle px-xs py-2xs text-2xs font-semibold text-foreground-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
      {CLAUSE_COPY.cautionBadge}
    </span>
  );
}
