'use client';

/**
 * CompletionDownload — the "완료 문서" download area (design-spec
 * `components/completion-download/base.md`).
 *
 * Presentational + self-contained per-row loading/error state; the caller
 * supplies `onDownload(kind)` wired to its own auth (owner JWT on the dashboard,
 * signer session on the completion screen). Reuses the existing StatusBadge and
 * Button — no new visual primitives. Until the artifacts are stored the rows
 * show a skeleton-shimmer placeholder ("준비 중"); once ready they become two
 * download rows (최종 계약서 / 감사 추적 인증서).
 */

import * as React from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import { StatusBadge } from '@/components/status-badge';
import { ApiError } from '@/lib/api';
import {
  COMPLETION_ARTIFACTS,
  COMPLETION_DOWNLOAD_COPY,
  formatKstDateTime,
  supportsFileShare,
  type CompletionArtifact,
} from '@/lib/completion-download';

export interface CompletionDownloadProps {
  /** Whether artifacts are stored and downloadable; false → "준비 중" skeleton. */
  ready: boolean;
  /** ISO completion timestamp for the notice (optional). */
  completedAt?: string | null;
  /** Korean status label for the badge (single source: server `statusLabel`). */
  statusLabel?: string;
  /** Show the COMPLETED status badge beside the section title. */
  showBadge?: boolean;
  /** Download one artifact; rejects with a user-facing message on failure. */
  onDownload: (kind: CompletionArtifact) => Promise<void>;
  className?: string;
}

export function CompletionDownload({
  ready,
  completedAt,
  statusLabel = '완료됨',
  showBadge = true,
  onDownload,
  className,
}: CompletionDownloadProps) {
  const completedLabel = formatKstDateTime(completedAt ?? null);

  // Progressive enhancement: on file-share-capable browsers (iOS Safari,
  // Android Chrome) the action opens the system share sheet, so the CTA reads
  // "공유" there. Detect after mount so SSR/first paint stays "내려받기" (no
  // hydration mismatch); desktop/legacy never flips → identical to before.
  const [shareMode, setShareMode] = React.useState(false);
  React.useEffect(() => setShareMode(supportsFileShare()), []);
  const ctaLabel = shareMode ? COMPLETION_DOWNLOAD_COPY.shareCta : COMPLETION_DOWNLOAD_COPY.cta;

  return (
    <section
      className={cn('flex flex-col gap-sm text-left', className)}
      aria-label={COMPLETION_DOWNLOAD_COPY.sectionTitle}
    >
      <div className="flex items-center justify-between gap-xs">
        <h4 className="text-sm font-bold text-foreground">
          {COMPLETION_DOWNLOAD_COPY.sectionTitle}
        </h4>
        {showBadge ? <StatusBadge status="COMPLETED" label={statusLabel} /> : null}
      </div>

      {completedLabel ? (
        <p className="text-sm text-foreground-subtle">
          {COMPLETION_DOWNLOAD_COPY.notice(completedLabel)}
        </p>
      ) : null}

      {ready ? (
        <ul className="flex flex-col gap-sm">
          {COMPLETION_ARTIFACTS.map((kind) => (
            <li key={kind}>
              <DownloadRow kind={kind} onDownload={onDownload} ctaLabel={ctaLabel} />
            </li>
          ))}
        </ul>
      ) : (
        <PreparingPlaceholder />
      )}
    </section>
  );
}

function DownloadRow({
  kind,
  onDownload,
  ctaLabel,
}: {
  kind: CompletionArtifact;
  onDownload: (kind: CompletionArtifact) => Promise<void>;
  ctaLabel: string;
}) {
  const item = COMPLETION_DOWNLOAD_COPY.items[kind];
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handle = async () => {
    setLoading(true);
    setError(null);
    try {
      await onDownload(kind);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : COMPLETION_DOWNLOAD_COPY.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2xs rounded-md border border-border bg-surface-muted px-md py-sm">
      {/* Narrow screens (shared signer completion + dashboard): stack the
          title over the button so the CTA/filename never collide; `sm:` and up
          restores the original title-left / button-right row. */}
      <div className="flex flex-col items-start gap-sm sm:flex-row sm:items-center sm:justify-between sm:gap-md">
        <div className="flex min-w-0 flex-col gap-2xs self-stretch sm:self-auto">
          <p className="truncate text-base font-semibold text-foreground">{item.title}</p>
          <p className="text-sm text-foreground-subtle">{item.description}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          isLoading={loading}
          onClick={handle}
          className="min-hit-target shrink-0"
        >
          {ctaLabel}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Skeleton-shimmer placeholder shown while post-processing stores the files. */
function PreparingPlaceholder() {
  return (
    <div className="flex flex-col gap-sm">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-md rounded-md border border-border bg-surface-muted px-md py-sm"
        >
          <div className="flex flex-1 flex-col gap-2xs">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton shape="rect" className="h-9 w-20" />
        </div>
      ))}
      <p className="text-sm text-foreground-subtle">{COMPLETION_DOWNLOAD_COPY.preparing}</p>
    </div>
  );
}
