/**
 * SCHEDULED dashboard display — unit tests for grain-1.
 *
 * Pins the three things a 예약됨 contract must show on the dashboard, each via the
 * pure module that drives it (the .tsx components are verified by build/lint):
 *   • the '예약됨' badge tone (STATUS_TONE.SCHEDULED — distinct amber, dark label),
 *   • the 예약 일시 meta text (absolute local YYYY.MM.DD HH:mm),
 *   • the kanban column: SCHEDULED groups on its own, ordered after 작성 중 and
 *     before 진행 중, and shown on demand (only when it holds a contract).
 * Plus the MANAGE_SCHEDULE next-action copy and the 예약됨 column label.
 *
 * Runs in the `node` jest environment; date cases build the instant from *local*
 * components so the formatter round-trips regardless of the runner's timezone.
 */

import { STATUS_TONE } from './status-tone';
import { COLUMN_ORDER, groupByStatus, visibleColumns } from './kanban';
import {
  KANBAN_BOARD_COPY,
  formatScheduledSendAt,
  nextActionCopy,
  scheduledSendMetaText,
} from './todo-copy';
import type { DocumentStatus, DocumentSummary } from './documents';

/** Minimal DocumentSummary stand-in — only the fields the display layer reads. */
function doc(over: Partial<DocumentSummary> & { id: string; status: DocumentStatus }): DocumentSummary {
  return {
    title: '근로계약서',
    statusLabel: '예약됨',
    storageKey: 'key',
    pageCount: 0,
    recipientCount: 0,
    sentAt: null,
    scheduledSendAt: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    completedAt: null,
    downloadsReady: false,
    urgency: 'NORMAL',
    nextAction: null,
    pendingSignerCount: 0,
    ...over,
  } as DocumentSummary;
}

describe('STATUS_TONE.SCHEDULED (예약됨 badge)', () => {
  it('has a distinct tone entry for SCHEDULED', () => {
    expect(STATUS_TONE.SCHEDULED).toBeDefined();
    // Amber (warning) hue, distinct from DRAFT(grey) / IN_PROGRESS(primary) /
    // COMPLETED(success) / CANCELLED(grey).
    expect(STATUS_TONE.SCHEDULED.dot).toBe('bg-warning');
    expect(STATUS_TONE.SCHEDULED.tint).toBe('bg-warning-subtle');
    expect(STATUS_TONE.SCHEDULED.dot).not.toBe(STATUS_TONE.IN_PROGRESS.dot);
    expect(STATUS_TONE.SCHEDULED.dot).not.toBe(STATUS_TONE.DRAFT.dot);
  });

  it('keeps the label text dark (never tinted amber-on-amber — WCAG AA)', () => {
    expect(STATUS_TONE.SCHEDULED.text).toBe('text-foreground-muted');
  });
});

describe('예약 일시 meta text', () => {
  it('formats the scheduled instant as absolute local YYYY.MM.DD HH:mm', () => {
    // Built from local components → round-trips regardless of the runner's TZ.
    const iso = new Date(2026, 7, 15, 14, 30, 0).toISOString();
    expect(formatScheduledSendAt(iso)).toBe('2026.08.15 14:30');
    expect(scheduledSendMetaText(iso)).toBe('예약 일시 2026.08.15 14:30');
  });

  it('zero-pads single-digit month, day, hour and minute', () => {
    const iso = new Date(2026, 0, 3, 9, 5, 0).toISOString();
    expect(formatScheduledSendAt(iso)).toBe('2026.01.03 09:05');
  });

  it('returns null when there is no scheduled instant (non-SCHEDULED cards omit it)', () => {
    expect(scheduledSendMetaText(null)).toBeNull();
    expect(scheduledSendMetaText('not-a-date')).toBeNull();
  });
});

describe('kanban column for SCHEDULED', () => {
  it('orders 예약됨 after 작성 중 and before 진행 중', () => {
    const draft = COLUMN_ORDER.indexOf('DRAFT');
    const scheduled = COLUMN_ORDER.indexOf('SCHEDULED');
    const inProgress = COLUMN_ORDER.indexOf('IN_PROGRESS');
    expect(scheduled).toBeGreaterThan(draft);
    expect(scheduled).toBeLessThan(inProgress);
  });

  it('groups SCHEDULED contracts into their own column, preserving order', () => {
    const groups = groupByStatus([
      doc({ id: 'a', status: 'SCHEDULED' }),
      doc({ id: 'b', status: 'DRAFT' }),
      doc({ id: 'c', status: 'SCHEDULED' }),
    ]);
    expect(groups.SCHEDULED.map((d) => d.id)).toEqual(['a', 'c']);
    expect(groups.DRAFT.map((d) => d.id)).toEqual(['b']);
  });

  it('shows the 예약됨 column only when a SCHEDULED contract is present (on demand)', () => {
    const withNone = visibleColumns(groupByStatus([doc({ id: 'a', status: 'DRAFT' })]));
    expect(withNone).not.toContain('SCHEDULED');
    // The three always-on columns are still there.
    expect(withNone).toEqual(['DRAFT', 'IN_PROGRESS', 'COMPLETED']);

    const withOne = visibleColumns(groupByStatus([doc({ id: 'a', status: 'SCHEDULED' })]));
    expect(withOne).toContain('SCHEDULED');
    expect(withOne).toEqual(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED']);
  });
});

describe('SCHEDULED copy', () => {
  it('labels the kanban column 예약됨', () => {
    expect(KANBAN_BOARD_COPY.columnLabel.SCHEDULED).toBe('예약됨');
  });

  it('maps the MANAGE_SCHEDULE next action to an actionable 예약 관리 CTA', () => {
    expect(nextActionCopy('MANAGE_SCHEDULE')).toEqual({ label: '예약 관리', kind: 'cta' });
  });
});
