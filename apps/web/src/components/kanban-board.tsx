'use client';

import * as React from 'react';
import { cn } from '@repo/ui';
import { ContractCard } from '@/components/contract-card';
import { STATUS_TONE } from '@/components/status-badge';
import type { DocumentStatus, DocumentSummary } from '@/lib/documents';

/**
 * KanbanBoard — the dashboard's 칸반 view (design-spec
 * `components/kanban-board/base.md`). It lays the *same* documents the list shows
 * (the `visible` set — already filtered by the active summary card and urgency-
 * sorted) into columns by lifecycle status, so switching 목록↔칸반 loses no
 * context and applies the same filter (same `visible` set → context preserved).
 *
 * Design decisions (design-spec):
 * - Columns follow the lifecycle left→right: 작성 중 → 진행 중 → 완료됨. These three
 *   always render (with an empty-column state) so the board's shape is stable.
 * - CANCELLED handling: 취소됨 is a terminal, inactive state. Rather than a
 *   permanently-empty fourth column (visual noise) or hiding cancelled work
 *   outright, the 취소됨 column renders **only when the visible set actually
 *   contains a cancelled contract** — a calm, de-emphasized (neutral) column shown
 *   on demand.
 * - Column highlight reuses `STATUS_TONE` from status-badge (the same status reads
 *   with the same hue as its badge; no color re-declared).
 * - Cards reuse ContractCard in its `compact` density (design-spec
 *   `components/contract-card/compact.md`).
 *
 * Copy is never owned here: column labels / count unit / empty-column text come in
 * via `copy` (source: design-spec/messaging/todo-copy.md via lib/todo-copy.ts).
 */

export interface KanbanBoardCopy {
  /** Column header label per status, e.g. `{ DRAFT: '작성 중', ... }`. */
  columnLabel: Record<DocumentStatus, string>;
  /** Count-unit noun for the column's screen-reader label, e.g. "건". */
  countUnit: string;
  /** Text shown in a column with no contracts. */
  emptyColumn: string;
  /** Accessible name for the whole board. */
  boardLabel: string;
}

/** Column order = lifecycle left→right. CANCELLED renders only when present. */
const COLUMN_ORDER: readonly DocumentStatus[] = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function groupByStatus(documents: DocumentSummary[]): Record<DocumentStatus, DocumentSummary[]> {
  const groups: Record<DocumentStatus, DocumentSummary[]> = {
    DRAFT: [],
    IN_PROGRESS: [],
    COMPLETED: [],
    CANCELLED: [],
  };
  // `documents` is the already urgency-sorted visible set, so each column keeps
  // that ordering by construction.
  for (const doc of documents) groups[doc.status]?.push(doc);
  return groups;
}

export interface KanbanBoardProps {
  /** The visible (filtered + urgency-sorted) set — the exact list the 목록 view shows. */
  documents: DocumentSummary[];
  /** Column labels + count unit + empty text (source: messaging/todo-copy.md). */
  copy: KanbanBoardCopy;
  /** Briefly ring-highlight a just-sent contract, matching the list. */
  highlightId?: string | null;
  className?: string;
}

export function KanbanBoard({ documents, copy, highlightId, className }: KanbanBoardProps) {
  const groups = React.useMemo(() => groupByStatus(documents), [documents]);
  // 작성 중 / 진행 중 / 완료됨 always render; 취소됨 only when it has cards.
  const columns = COLUMN_ORDER.filter(
    (status) => status !== 'CANCELLED' || groups.CANCELLED.length > 0,
  );

  return (
    <div
      role="group"
      aria-label={copy.boardLabel}
      className={cn('flex gap-md overflow-x-auto pb-sm', className)}
    >
      {columns.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          label={copy.columnLabel[status]}
          countUnit={copy.countUnit}
          emptyCopy={copy.emptyColumn}
          documents={groups[status]}
          highlightId={highlightId}
        />
      ))}
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  countUnit,
  emptyCopy,
  documents,
  highlightId,
}: {
  status: DocumentStatus;
  label: string;
  countUnit: string;
  emptyCopy: string;
  documents: DocumentSummary[];
  highlightId?: string | null;
}) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.DRAFT;
  const count = documents.length;
  return (
    <section
      // Not color alone: the label text + count carry the meaning; SR reads
      // "작성 중 2건". The tone tint/dot is a secondary signal.
      aria-label={`${label} ${count}${countUnit}`}
      className="flex w-[17.5rem] shrink-0 flex-col gap-sm"
    >
      <header className={cn('flex items-center justify-between gap-xs rounded-lg px-sm py-xs', tone.tint)}>
        <span className="flex items-center gap-2xs">
          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
          <span className={cn('text-sm font-semibold', tone.text)}>{label}</span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground-subtle" aria-hidden="true">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-sm py-lg text-center text-sm text-foreground-subtle">
          {emptyCopy}
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {documents.map((doc) => (
            <li key={doc.id}>
              <ContractCard document={doc} variant="compact" highlighted={doc.id === highlightId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
