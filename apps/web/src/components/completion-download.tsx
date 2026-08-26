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
  completionDownloadCopyFor,
  formatKstDateTime,
  type CompletionArtifact,
} from '@/lib/completion-download';
import { useLocale } from '@/components/locale-provider';

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
  statusLabel,
  showBadge = true,
  onDownload,
  className,
}: CompletionDownloadProps) {
  const { locale } = useLocale();
  const copy = completionDownloadCopyFor(locale);
  const completedLabel = formatKstDateTime(completedAt ?? null);
  const resolvedStatusLabel = statusLabel ?? (locale === 'en' ? 'Completed' : '완료됨');

  return (
    <section
      className={cn('flex flex-col gap-sm text-left', className)}
      aria-label={copy.sectionTitle}
    >
      <div className="flex items-center justify-between gap-xs">
        <h4 className="text-sm font-bold text-foreground">
          {copy.sectionTitle}
        </h4>
        {showBadge ? <StatusBadge status="COMPLETED" label={resolvedStatusLabel} /> : null}
      </div>

      {completedLabel ? (
        <p className="text-sm text-foreground-subtle">
          {copy.notice(completedLabel)}
        </p>
      ) : null}

      {ready ? (
        <ul className="flex flex-col gap-sm">
          {COMPLETION_ARTIFACTS.map((kind) => (
            <li key={kind}>
              <DownloadRow kind={kind} onDownload={onDownload} copy={copy} />
            </li>
          ))}
        </ul>
      ) : (
        <PreparingPlaceholder copy={copy} />
      )}
    </section>
  );
}

function DownloadRow({
  kind,
  onDownload,
  copy,
}: {
  kind: CompletionArtifact;
  onDownload: (kind: CompletionArtifact) => Promise<void>;
  copy: ReturnType<typeof completionDownloadCopyFor>;
}) {
  const item = copy.items[kind];
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handle = async () => {
    setLoading(true);
    setError(null);
    try {
      await onDownload(kind);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2xs rounded-md border border-border bg-surface-muted px-md py-sm">
      <div className="flex items-center justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-2xs">
          <p className="truncate text-base font-semibold text-foreground">{item.title}</p>
          <p className="text-sm text-foreground-subtle">{item.description}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          isLoading={loading}
          onClick={handle}
          className="shrink-0"
        >
          {copy.cta}
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
function PreparingPlaceholder({ copy }: { copy: ReturnType<typeof completionDownloadCopyFor> }) {
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
      <p className="text-sm text-foreground-subtle">{copy.preparing}</p>
    </div>
  );
}
