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
import { Confetti, SuccessCheck } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { CompletionDownload } from '@/components/completion-download';
import {
  completionArtifactState,
  completionSummaryRows,
  type CompletionSummaryRowKey,
} from '@/lib/signing';
import { useFill } from './fill-context';

export function CompletionScreen() {
  const {
    brandColor,
    documentTitle,
    payload,
    documentCompleted,
    documentReady,
    summary,
    copy,
    download,
  } = useFill();
  const done = copy.done;

  // Portals need the DOM; gate on mount so SSR/first paint stays clean.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const title = payload?.documentTitle ?? documentTitle;
  const nextStep = documentCompleted ? done.nextAllDone : done.nextWaiting;

  // Real-value summary rows (계약 날짜·금액·서명 완료 시각), empty rows omitted.
  const factRows = summary ? completionSummaryRows(summary) : [];
  const rowLabels: Record<CompletionSummaryRowKey, string | undefined> = {
    contractDate: done.contractDateLabel,
    contractAmount: done.contractAmountLabel,
    signedAt: done.signedAtLabel,
  };

  // 준비 완료 → 다운로드 버튼 / 처리 중 → 계약서 준비 중 안내 / 그 외 → 없음.
  const artifactState = completionArtifactState({
    hasDownload: !!download,
    documentReady: documentReady ?? false,
    documentCompleted,
  });

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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-xl bg-background px-lg text-center"
    >
      <div className="relative flex items-center justify-center">
        <Confetti className="z-0" />
        <SuccessCheck size={104} className="relative z-10" aria-label={done.title} />
      </div>

      <div className="motion-stagger flex w-full max-w-[420px] flex-col items-center gap-sm">
        <h1 className="text-2xl font-bold text-foreground">{done.title}</h1>
        <p className="text-base text-foreground-subtle">{done.body}</p>

        <dl className="mt-xs w-full rounded-md border border-border bg-surface-muted px-md py-sm text-left">
          <div>
            <dt className="text-2xs font-medium text-foreground-subtle">{done.documentLabel}</dt>
            <dd className="mt-2xs truncate text-sm font-semibold text-foreground">{title}</dd>
          </div>
          {factRows.map((row) => {
            const label = rowLabels[row.key];
            if (!label) return null;
            return (
              <div key={row.key} className="mt-sm">
                <dt className="text-2xs font-medium text-foreground-subtle">{label}</dt>
                <dd className="mt-2xs text-sm font-semibold text-foreground">{row.value}</dd>
              </div>
            );
          })}
        </dl>

        <p className="mt-xs text-sm text-foreground-subtle">{nextStep}</p>

        {artifactState === 'download' && download ? (
          <CompletionDownload
            className="mt-xs w-full rounded-md border border-border bg-surface px-md py-md"
            ready
            showBadge={false}
            onDownload={(kind) => download.onDownload(kind)}
          />
        ) : artifactState === 'processing' && done.processing ? (
          <p className="mt-xs w-full rounded-md border border-border bg-surface px-md py-md text-sm text-foreground-subtle">
            {done.processing}
          </p>
        ) : null}
      </div>
    </div>,
    window.document.body,
  );
}
