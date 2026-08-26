/**
 * TO-DO dashboard copy — locale-aware selectors that turn the contract list into
 * a work queue (urgency labels, next-action copy, the pending-signer line, and
 * the summary/kanban/view-switcher prop copy).
 *
 * Source of truth for the strings is the `todo` namespace of the web translation
 * catalog (`web-translations.ts`); this module maps the domain model
 * (urgency/next-action/status enums) onto those keys. Every user-facing string is
 * resolved through `translateWeb(locale, …)`, so switching the locale re-renders
 * the whole work queue with no hardcoded Korean here. Presentational components
 * still take copy as props (they never own wording) — the consumers build the
 * copy objects below from the active locale and pass them down.
 */

import type { NextAction, Urgency } from './documents';
import type { SupportedLocale } from './locale';
import { translateWeb, type WebTranslationKey } from './web-translations';
import type { DashboardSummaryCopy } from '@/components/dashboard-summary';
import type { ViewSwitcherCopy } from '@/components/view-switcher';
import type { KanbanBoardCopy } from '@/components/kanban-board';

/**
 * Urgency labels — shared verbatim by the UrgencyBadge and the summary cards so
 * the same urgency reads with the same word across the dashboard. NORMAL carries
 * no label (no badge is rendered).
 */
const URGENCY_KEY: Record<Exclude<Urgency, 'NORMAL'>, WebTranslationKey> = {
  OVERDUE: 'todo.urgencyOverdue',
  DUE_SOON: 'todo.urgencyDueSoon',
};

/** The urgency label for a badge; empty for NORMAL (badge renders nothing then). */
export function urgencyLabel(urgency: Urgency, locale: SupportedLocale): string {
  return urgency === 'NORMAL' ? '' : translateWeb(locale, URGENCY_KEY[urgency]);
}

/**
 * NextAction copy. `cta` actions are value-carrying verb phrases (the primary
 * next step); `status` is a passive state label with no owner action to take
 * right now. `CANCELLED` maps to `null` (no next action).
 */
export type NextActionKind = 'cta' | 'status';

export interface NextActionCopy {
  label: string;
  kind: NextActionKind;
}

const NEXT_ACTION_META: Record<NextAction, { key: WebTranslationKey; kind: NextActionKind }> = {
  SEND_DRAFT: { key: 'todo.nextSendDraft', kind: 'cta' },
  AWAITING_SIGN: { key: 'todo.nextAwaitingSign', kind: 'status' },
  DOWNLOAD: { key: 'todo.nextDownload', kind: 'cta' },
};

/** The card's next-action copy, or `null` when there is none (CANCELLED). */
export function nextActionCopy(
  action: NextAction | null,
  locale: SupportedLocale,
): NextActionCopy | null {
  if (!action) return null;
  const meta = NEXT_ACTION_META[action];
  return { label: translateWeb(locale, meta.key), kind: meta.kind };
}

/**
 * Pending-signer line: the short form `서명 대기 {N}명`, aligned with the
 * existing `받는 분 {N}명` meta wording. `null` at 0 so the caller omits the line
 * entirely (no "0명 대기" noise).
 */
export function pendingSignerLabel(count: number, locale: SupportedLocale): string | null {
  return count > 0 ? translateWeb(locale, 'todo.pendingSigners', { count }) : null;
}

/**
 * Summary-card titles + count unit. Titles reuse the urgency vocabulary plus the
 * IN_PROGRESS superset ("서명 대기 중"); the count unit aligns with the contract
 * domain ("건").
 */
export function summaryCopy(locale: SupportedLocale): DashboardSummaryCopy {
  return {
    title: {
      OVERDUE: translateWeb(locale, 'todo.summaryOverdue'),
      DUE_SOON: translateWeb(locale, 'todo.summaryDueSoon'),
      AWAITING: translateWeb(locale, 'todo.summaryAwaiting'),
    },
    countUnit: translateWeb(locale, 'todo.countUnit'),
  };
}

/**
 * Shown when a summary-card filter is active but no contract matches it. Base
 * voice: state it calmly and give the next action (clear the filter).
 */
export function filteredEmptyCopy(locale: SupportedLocale): { message: string; clear: string } {
  return {
    message: translateWeb(locale, 'todo.filteredEmpty'),
    clear: translateWeb(locale, 'todo.filteredClear'),
  };
}

/**
 * View switcher labels. The dashboard shows its contracts as a TO-DO 목록 (list)
 * or a 칸반 (kanban) board; the ViewSwitcher takes these as props so it never
 * owns the wording. `groupLabel` names the control for screen readers.
 */
export function viewSwitcherCopy(locale: SupportedLocale): ViewSwitcherCopy {
  return {
    label: {
      list: translateWeb(locale, 'todo.viewList'),
      kanban: translateWeb(locale, 'todo.viewKanban'),
    },
    groupLabel: translateWeb(locale, 'todo.viewGroupLabel'),
  };
}

/**
 * Kanban board copy. Column headers reuse the project's established status
 * vocabulary so a status reads with the same word on every screen; `countUnit`
 * matches the summary cards; the empty-column line states calmly that the column
 * has nothing.
 */
export function kanbanBoardCopy(locale: SupportedLocale): KanbanBoardCopy {
  return {
    columnLabel: {
      DRAFT: translateWeb(locale, 'todo.columnDraft'),
      SCHEDULED: translateWeb(locale, 'todo.columnScheduled'),
      IN_PROGRESS: translateWeb(locale, 'todo.columnInProgress'),
      COMPLETED: translateWeb(locale, 'todo.columnCompleted'),
      CANCELLED: translateWeb(locale, 'todo.columnCancelled'),
    },
    countUnit: translateWeb(locale, 'todo.countUnit'),
    emptyColumn: translateWeb(locale, 'todo.emptyColumn'),
    boardLabel: translateWeb(locale, 'todo.boardLabel'),
  };
}
