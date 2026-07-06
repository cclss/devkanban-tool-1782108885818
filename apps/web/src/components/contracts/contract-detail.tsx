'use client';

/**
 * ContractDetail — the sender's read-only contract summary
 * (design-spec components/contract-detail/base.md).
 *
 * Presentational: the route owns data fetching and the loading/error/404 states.
 * Renders the title + status, a summary definition list (받는 분 · 분량 · 날짜),
 * and the ShareLinksSection ('링크로 공유' entry point + link list slot). Completed
 * contracts also surface the existing CompletionDownload area so the owner can
 * grab the finished artifacts from the detail view.
 */

import * as React from 'react';
import { Card } from '@repo/ui';
import { StatusBadge } from '@/components/status-badge';
import { CompletionDownload } from '@/components/completion-download';
import { CONTRACT_DETAIL_COPY } from '@/lib/contract-detail';
import { downloadOwnerArtifact, type DocumentDetail } from '@/lib/documents';
import { ShareLinksSection } from './share-links-section';

const COPY = CONTRACT_DETAIL_COPY;

export function ContractDetail({ document }: { document: DocumentDetail }) {
  const completed = document.status === 'COMPLETED';

  return (
    <div className="motion-stagger flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <div className="flex items-start gap-md">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
            <DocumentIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <h1 className="break-words text-2xl font-bold text-foreground">{document.title}</h1>
            <StatusBadge
              status={document.status}
              label={document.statusLabel}
              className="self-start"
            />
          </div>
        </div>
      </header>

      <SummaryCard document={document} />

      <ShareLinksSection documentId={document.id} documentTitle={document.title} />

      {completed ? (
        <Card className="p-lg">
          <CompletionDownload
            ready={document.downloadsReady}
            completedAt={document.completedAt}
            statusLabel={document.statusLabel}
            showBadge={false}
            onDownload={(kind) => downloadOwnerArtifact(document.id, kind, document.title)}
          />
        </Card>
      ) : null}
    </div>
  );
}

function SummaryCard({ document }: { document: DocumentDetail }) {
  const sent = document.status !== 'DRAFT' && Boolean(document.sentAt);
  const recipientValue =
    document.recipientCount > 0
      ? COPY.summary.recipientCount(document.recipientCount)
      : COPY.summary.linkOnly;

  return (
    <Card className="flex flex-col p-lg">
      <dl className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <SummaryRow label={COPY.summary.recipients} value={recipientValue} />
        <SummaryRow
          label={COPY.summary.pages}
          value={COPY.summary.pageCount(document.pageCount)}
        />
        <SummaryRow
          label={sent ? COPY.summary.sent : COPY.summary.created}
          value={formatDate(sent ? (document.sentAt as string) : document.createdAt)}
        />
        {document.completedAt ? (
          <SummaryRow label={COPY.summary.completed} value={formatDate(document.completedAt)} />
        ) : null}
      </dl>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2xs">
      <dt className="text-sm text-foreground-subtle">{label}</dt>
      <dd className="text-base font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/** ISO → "YYYY.MM.DD" (matches the dashboard's date fallback format). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M8.5 13h7M8.5 16.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
