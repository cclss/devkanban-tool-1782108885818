'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, cn } from '@repo/ui';
import { StatusBadge } from '@/components/status-badge';
import { UrgencyBadge } from '@/components/urgency-badge';
import { CompletionDownload } from '@/components/completion-download';
import { downloadOwnerArtifact, type DocumentSummary, type NextAction } from '@/lib/documents';
import { nextActionCopy, pendingSignerLabel, urgencyLabel } from '@/lib/todo-copy';

/**
 * ContractCard — one contract as a card, shared by the dashboard **list** and the
 * **kanban** board (design-spec `components/contract-card/base.md`). Extracted from
 * dashboard/page.tsx so both views render the same card and stay in sync.
 *
 * Two densities (design-spec `components/contract-card/compact.md`):
 * - `default` (list): the required elements plus the optional list affordances — a
 *   trailing chevron, and for a COMPLETED contract the inline completion-download
 *   region (its own interactive buttons, so only the header row is the link).
 * - `compact` (board): a denser card for the narrow kanban columns. The required
 *   elements are identical; the optional chevron and the inline download region are
 *   dropped, so the whole card is a single link to the detail screen (where the
 *   download lives). The StatusBadge is always shown here because there is no
 *   download region to carry the 완료됨 badge.
 *
 * Copy is never owned here: labels come from the central copy module
 * (design-spec/messaging/todo-copy.md via lib/todo-copy.ts).
 */
export type ContractCardVariant = 'default' | 'compact';

export interface ContractCardProps {
  document: DocumentSummary;
  /** List (`default`) or board (`compact`) density. */
  variant?: ContractCardVariant;
  /** Briefly ring-highlight a just-sent contract. */
  highlighted?: boolean;
}

export function ContractCard({ document, variant = 'default', highlighted = false }: ContractCardProps) {
  const compact = variant === 'compact';
  const completed = document.status === 'COMPLETED';
  const href = `/contracts/${document.id}`;
  const cardClass = cn(
    'flex flex-col transition-shadow',
    compact ? 'gap-sm p-md' : 'gap-md p-lg',
    highlighted && 'ring-2 ring-focus',
  );

  // In the list, a completed card holds its own interactive download buttons, so
  // only the header row can be a link (no nested interactives). The compact board
  // card drops that region, so — like every other card — the whole card navigates.
  if (completed && !compact) {
    return (
      <Card className={cardClass}>
        <Link
          href={href}
          className="-m-2xs flex items-center gap-md rounded-md p-2xs transition-colors duration-fast ease-standard hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
        >
          <CardHeaderRow document={document} completed variant={variant} />
        </Link>
        <CompletionDownload
          className="border-t border-border pt-md"
          ready={document.downloadsReady}
          completedAt={document.completedAt}
          statusLabel={document.statusLabel}
          onDownload={(kind) => downloadOwnerArtifact(document.id, kind, document.title)}
        />
      </Card>
    );
  }

  // Cards with no inner interactives navigate as a whole.
  return (
    <Link
      href={href}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
    >
      <Card interactive className={cardClass}>
        <div className={cn('flex items-center', compact ? 'gap-sm' : 'gap-md')}>
          <CardHeaderRow document={document} completed={completed} variant={variant} />
        </div>
      </Card>
    </Link>
  );
}

function CardHeaderRow({
  document,
  completed,
  variant,
}: {
  document: DocumentSummary;
  completed: boolean;
  variant: ContractCardVariant;
}) {
  const compact = variant === 'compact';
  // The list's completed card carries the 완료됨 badge inside its download region,
  // so the title row omits it there to avoid a duplicate. The compact card has no
  // download region, so it always shows the status badge.
  const showStatusBadge = compact || !completed;
  return (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <DocumentIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <div className="flex flex-wrap items-center gap-xs">
          <h3 className="truncate text-base font-bold text-foreground">{document.title}</h3>
          {showStatusBadge ? (
            <StatusBadge status={document.status} label={document.statusLabel} />
          ) : null}
          {/* Urgency rides on a separate axis next to the lifecycle status; it
              renders nothing for NORMAL (incl. completed/cancelled). */}
          <UrgencyBadge urgency={document.urgency} label={urgencyLabel(document.urgency)} />
        </div>
        <p className="truncate text-sm text-foreground-subtle">{metaLine(document)}</p>
      </div>
      {/* The single next action as a compact hint. Completed cards render DOWNLOAD
          via the list's download region (and the compact card defers it to the
          detail screen), so the hint is shown only for non-completed cards — the
          same DOWNLOAD-not-in-header treatment in both densities. */}
      {!completed ? <NextActionHint action={document.nextAction} /> : null}
      {/* The chevron is a list-only entry affordance; the board's column cards drop
          it (denser, and the card itself is the link). */}
      {!compact ? <ChevronIcon /> : null}
    </>
  );
}

/**
 * The document's single next action as a compact hint (copy: todo-copy.md). CTAs
 * (발송하기 / 내려받기) read as a primary-tinted pill — the whole card is the
 * link that opens the contract where the action lives, so this is a visual
 * affordance, not a nested interactive. `AWAITING_SIGN` is a passive status label
 * (no owner action right now — no reminder feature); CANCELLED renders nothing.
 */
function NextActionHint({ action }: { action: NextAction | null }) {
  const copy = nextActionCopy(action);
  if (!copy) return null;
  if (copy.kind === 'status') {
    return (
      <span className="shrink-0 text-sm font-medium text-foreground-subtle">{copy.label}</span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-primary-subtle px-sm py-2xs text-sm font-semibold text-primary">
      {copy.label}
    </span>
  );
}

function metaLine(doc: DocumentSummary): string {
  const parts: string[] = [];
  if (doc.recipientCount > 0) parts.push(`받는 분 ${doc.recipientCount}명`);
  // Signers still awaited (omitted at 0 — see todo-copy.md).
  const pending = pendingSignerLabel(doc.pendingSignerCount);
  if (pending) parts.push(pending);
  if (doc.pageCount > 0) parts.push(`${doc.pageCount}페이지`);
  const sent = doc.status !== 'DRAFT' && doc.sentAt;
  const when = formatRelative(sent ? (doc.sentAt as string) : doc.createdAt);
  parts.push(sent ? `${when} 발송` : `${when} 생성`);
  return parts.join(' · ');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(then);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M8.5 13h7M8.5 16.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-grey-400" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
