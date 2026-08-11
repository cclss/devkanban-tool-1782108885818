'use client';

/**
 * AlreadySignedScreen — the re-entry terminal for a link the signer already
 * finished (spec §6 경계 / S-6 "추가 케이스").
 *
 * A signer who reopens a completed link must NOT see the sign flow again. Instead
 * this calm takeover confirms the contract is done: a success glyph + the exact
 * "이미 서명 완료된 계약입니다" headline, the same completed summary card they saw
 * on finishing (문서 제목 + 계약 날짜·금액·서명 완료 시각, empty rows omitted), and
 * — once the final signed PDF is ready — a download area. Nothing here captures a
 * signature: the sign viewer is never mounted for this reason.
 *
 * All facts come from the pre-auth {@link SigningMeta} (no session needed to
 * *see* them). The download itself is session-guarded: a re-opened tab holds no
 * signer session, so 내려받기 requires 재본인확인 to mint a short-lived session —
 * {@link downloadSignerArtifact} surfaces that as the row's error when no session
 * exists, and succeeds immediately on a same-tab re-entry where the session
 * persists (recording.md: 재본인확인 단기 세션 발급).
 */

import * as React from 'react';
import {
  completionSummaryRows,
  downloadSignerArtifact,
  reentryArtifactState,
  reentrySummary,
  SIGNER_COPY,
  type CompletionSummaryRowKey,
  type SigningMeta,
} from '@/lib/signing';
import { brandStyle } from '@/lib/branding';
import { CompletionDownload } from '@/components/completion-download';
import { BrandingHeader } from './branding-header';
import { useSigner } from './signer-context';

export function AlreadySignedScreen({ meta }: { meta: SigningMeta }) {
  const { token } = useSigner();
  const copy = SIGNER_COPY.reentry;
  const done = SIGNER_COPY.done;

  const title = meta.documentTitle;
  const factRows = completionSummaryRows(reentrySummary(meta));
  const rowLabels: Record<CompletionSummaryRowKey, string> = {
    contractDate: done.contractDateLabel,
    contractAmount: done.contractAmountLabel,
    signedAt: done.signedAtLabel,
  };

  // 준비 완료 → 다운로드 / 처리 중 → 준비 중 안내 / 그 외 → 없음.
  const artifactState = reentryArtifactState(meta);

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="motion-stagger flex flex-1 flex-col items-center justify-center text-center">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-success-subtle text-success"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className="mt-lg text-2xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-xs text-base text-foreground-subtle">{copy.body}</p>

        <dl className="mt-xl w-full rounded-md border border-border bg-surface-muted px-md py-sm text-left">
          <div>
            <dt className="text-2xs font-medium text-foreground-subtle">{done.documentLabel}</dt>
            <dd className="mt-2xs truncate text-sm font-semibold text-foreground">{title}</dd>
          </div>
          {factRows.map((row) => (
            <div key={row.key} className="mt-sm">
              <dt className="text-2xs font-medium text-foreground-subtle">
                {rowLabels[row.key]}
              </dt>
              <dd className="mt-2xs text-sm font-semibold text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>

        {artifactState === 'download' ? (
          <CompletionDownload
            className="mt-md w-full rounded-md border border-border bg-surface px-md py-md"
            ready
            showBadge={false}
            onDownload={(kind) => downloadSignerArtifact(token, kind, title)}
          />
        ) : artifactState === 'processing' ? (
          <p className="mt-md w-full rounded-md border border-border bg-surface px-md py-md text-sm text-foreground-subtle">
            {done.processing}
          </p>
        ) : null}
      </div>
    </main>
  );
}
