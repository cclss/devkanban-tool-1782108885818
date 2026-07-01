'use client';

/**
 * CompletionScreen — the signer's celebratory finish.
 *
 * Shown once the bottom CTA's `complete` call succeeds (phase `done`). A
 * full-viewport takeover owns the moment: the SuccessCheck ring/tick stroke-draw
 * with a Confetti burst fanning out of the mark, then the text fades in staggered
 * (headline → body → post-summary → what-happens-next) via the `motion-stagger`
 * token. A calm summary names the signed document and explains that the finished
 * copy will be mailed out — no further action is required of the signer.
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
import { SIGNER_COPY, downloadSignerArtifact, type SigningMeta } from '@/lib/signing';
import { useSigner } from './signer-context';

export function CompletionScreen({ meta }: { meta: SigningMeta }) {
  const { state, token } = useSigner();
  const { payload, documentCompleted } = state;

  // Portals need the DOM; gate on mount so SSR/first paint stays clean.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const documentTitle = payload?.documentTitle ?? meta.documentTitle;
  const nextStep = documentCompleted
    ? SIGNER_COPY.done.nextAllDone
    : SIGNER_COPY.done.nextWaiting;

  // Safe-area aware via foundation utils (not inline env()): `px-lg`/`py-lg`
  // set the base gutter + vertical rhythm; `.pt-safe`/`.pb-safe` add the
  // notch/home-indicator insets on top (0 on desktop → no-op).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={SIGNER_COPY.done.title}
      style={brandStyle(meta.sender.brandColor)}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-xl bg-background px-lg py-lg pt-safe pb-safe text-center"
    >
      <div className="relative flex items-center justify-center">
        <Confetti className="z-0" />
        <SuccessCheck size={104} className="relative z-10" aria-label={SIGNER_COPY.done.title} />
      </div>

      <div className="motion-stagger flex w-full max-w-[420px] flex-col items-center gap-sm">
        <h1 className="text-2xl font-bold text-foreground">{SIGNER_COPY.done.title}</h1>
        <p className="text-base text-foreground-subtle">{SIGNER_COPY.done.body}</p>

        <div className="mt-xs w-full rounded-md border border-border bg-surface-muted px-md py-sm text-left">
          <p className="text-2xs font-medium text-foreground-subtle">
            {SIGNER_COPY.done.documentLabel}
          </p>
          <p className="mt-2xs truncate text-sm font-semibold text-foreground">{documentTitle}</p>
        </div>

        <p className="mt-xs text-sm text-foreground-subtle">{nextStep}</p>

        {documentCompleted ? (
          <CompletionDownload
            className="mt-xs w-full rounded-md border border-border bg-surface px-md py-md"
            ready
            showBadge={false}
            onDownload={(kind) => downloadSignerArtifact(token, kind, documentTitle)}
          />
        ) : null}
      </div>
    </div>,
    window.document.body,
  );
}
