/**
 * Kanban layout logic — pure, React-free helpers for the dashboard's 칸반 view
 * (design-spec `components/kanban-board/base.md`). Kept out of the component so
 * the column ordering + visibility rules are unit-testable without rendering.
 *
 * Column order follows the lifecycle left→right: 작성 중 → 예약됨 → 진행 중 →
 * 완료됨 → 취소됨. `SCHEDULED` sits after `DRAFT` and before `IN_PROGRESS` — a
 * scheduled contract is past the draft stage (finalized + queued) but has not
 * been sent yet.
 *
 * On-demand columns (design-spec/content/status-tone-scheduled.md): the three
 * always-present states — 작성 중 / 진행 중 / 완료됨 — keep the board's shape
 * stable, while `SCHEDULED` (예약됨) and `CANCELLED` (취소됨) render a column only
 * when the visible set actually contains one. Both are states a given user may
 * never reach; showing a permanently-empty column for them would be noise, so the
 * column appears on demand.
 */

import type { DocumentStatus, DocumentSummary } from './documents';

/** Column order = lifecycle left→right. On-demand columns render only when present. */
export const COLUMN_ORDER: readonly DocumentStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

/**
 * Statuses whose column is shown only when the visible set contains one (calm,
 * on-demand). Every other status always renders its column (stable board shape).
 */
const ON_DEMAND_COLUMNS: ReadonlySet<DocumentStatus> = new Set<DocumentStatus>([
  'SCHEDULED',
  'CANCELLED',
]);

/** Partition the visible set into per-status columns, preserving input order. */
export function groupByStatus(
  documents: DocumentSummary[],
): Record<DocumentStatus, DocumentSummary[]> {
  const groups: Record<DocumentStatus, DocumentSummary[]> = {
    DRAFT: [],
    SCHEDULED: [],
    IN_PROGRESS: [],
    COMPLETED: [],
    CANCELLED: [],
  };
  // `documents` is the already urgency-sorted visible set, so each column keeps
  // that ordering by construction.
  for (const doc of documents) groups[doc.status]?.push(doc);
  return groups;
}

/**
 * The columns to render, in lifecycle order: always-present columns plus any
 * on-demand column (예약됨 / 취소됨) that currently holds at least one contract.
 */
export function visibleColumns(
  groups: Record<DocumentStatus, DocumentSummary[]>,
): DocumentStatus[] {
  return COLUMN_ORDER.filter(
    (status) => !ON_DEMAND_COLUMNS.has(status) || groups[status].length > 0,
  );
}
