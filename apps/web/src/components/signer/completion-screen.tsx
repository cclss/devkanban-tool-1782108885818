'use client';

/**
 * CompletionScreen — the recipient's celebratory finish.
 *
 * Shown once the bottom CTA's `complete` call succeeds (phase `done`). A
 * full-viewport takeover owns the moment: the SuccessCheck ring/tick stroke-draw
 * with a Confetti burst fanning out of the mark, then the text fades in staggered
 * (headline → body → post-summary → what-happens-next) via the `motion-stagger`
 * token. A calm summary names the finished document and explains what happens
 * next — no further action is required.
 *
 * Flow-neutral: all copy and the optional artifact download come from the
 * {@link useFill} adapter, so the OTP signer flow (with a download area) and the
 * link-share recipient flow (download hidden — a fill link has no artifact to
 * hand back) reuse this one screen.
 *
 * Rendered through a portal to <body> so no transformed/over­flow-clipped ancestor
 * can trap the fixed overlay; the brand hook is re-applied on the overlay itself
 * (it escapes the viewer's branded subtree). Under reduced-motion the global
 * fallback collapses every animation to its static end-state: the check is fully
 * drawn, the confetti stays invisible, and the staggered text is simply present.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Card, Confetti, SuccessCheck, cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { CompletionDownload } from '@/components/completion-download';
import { CLAUSE_CARD_COPY } from '@/lib/clause-card-copy';
import { clauseTone } from '@/lib/clause-summary';
import { CategoryPill, CautionMark, HighlightedText } from './clause-summary-section';
import { useFill } from './fill-context';

export function CompletionScreen() {
  const { brandColor, documentTitle, payload, clauseSummary, documentCompleted, copy, download } =
    useFill();
  const done = copy.done;

  // Portals need the DOM; gate on mount so SSR/first paint stays clean.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const title = payload?.documentTitle ?? documentTitle;
  const nextStep = documentCompleted ? done.nextAllDone : done.nextWaiting;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={done.title}
      style={{
        ...brandStyle(brandColor),
        // Safe-area aware: keep clear of notch/home-indicator on mobile.
        paddingTop: 'max(env(safe-area-inset-top), 24px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-xl overflow-y-auto bg-background px-lg text-center"
    >
      <div className="relative flex items-center justify-center">
        <Confetti className="z-0" />
        <SuccessCheck size={104} className="relative z-10" aria-label={done.title} />
      </div>

      <div className="motion-stagger flex w-full max-w-[420px] flex-col items-center gap-sm">
        <h1 className="text-2xl font-bold text-foreground">{done.title}</h1>
        <p className="text-base text-foreground-subtle">{done.body}</p>

        <div className="mt-xs w-full rounded-md border border-border bg-surface-muted px-md py-sm text-left">
          <p className="text-2xs font-medium text-foreground-subtle">{done.documentLabel}</p>
          <p className="mt-2xs truncate text-sm font-semibold text-foreground">{title}</p>
        </div>

        {clauseSummary ? (
          <ContractSummaryRecap summary={clauseSummary} heading={done.summaryHeading} />
        ) : null}

        <p className="mt-xs text-sm text-foreground-subtle">{nextStep}</p>

        {download && documentCompleted ? (
          <CompletionDownload
            className="mt-xs w-full rounded-md border border-border bg-surface px-md py-md"
            ready
            showBadge={false}
            onDownload={(kind) => download.onDownload(kind)}
          />
        ) : null}
      </div>
    </div>,
    window.document.body,
  );
}

/**
 * A light key-clause recap on the completion card: the one-liner plus each key
 * clause's headline, in the same clause-card visual family as the reading screen
 * (`clauseTone` surface/border, the shared `CategoryPill`, weight-only key-number
 * emphasis via `HighlightedText`, and the caution mark for `caution` clauses).
 *
 * Deliberately NOT the heavy `ClauseSummarySection`: no "원문에서 보기" anchors (no
 * viewer here), no pageCount, no AI disclaimer block. The AI framing is signaled
 * once via the shared `AI 요약` mark (mirrors the reading screen's "signal AI once"
 * rule); the details/detail lines are dropped to keep the recap concise. Only
 * mounted when `clauseSummary` is present — a `null` summary leaves the existing
 * completion card untouched (graceful degradation).
 */
function ContractSummaryRecap({
  summary,
  heading,
}: {
  summary: NonNullable<ReturnType<typeof useFill>['clauseSummary']>;
  heading: string;
}) {
  return (
    <section aria-label={heading} className="mt-xs w-full text-left">
      <div className="flex items-center gap-2xs">
        <h2 className="text-2xs font-bold uppercase tracking-wide text-foreground-subtle">
          {heading}
        </h2>
        <span className="text-2xs font-bold uppercase tracking-wide text-ai-accent-strong">
          {CLAUSE_CARD_COPY.aiMarkLabel}
        </span>
      </div>

      <p className="mt-2xs text-sm font-semibold leading-snug text-foreground">
        <HighlightedText text={summary.oneLiner} />
      </p>

      <ul className="mt-sm flex flex-col gap-2xs">
        {summary.clauses.map((clause, index) => {
          const tone = clauseTone(clause.emphasis);
          return (
            <li key={index}>
              <Card
                className={cn(
                  'flex flex-col gap-2xs p-md',
                  tone.surfaceClassName,
                  tone.borderClassName,
                )}
              >
                <div className="flex flex-wrap items-center gap-2xs">
                  <CategoryPill category={clause.category} />
                  {tone.caution ? <CautionMark /> : null}
                </div>
                <p className="text-sm font-semibold leading-snug text-foreground">
                  <HighlightedText text={clause.headline} />
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
