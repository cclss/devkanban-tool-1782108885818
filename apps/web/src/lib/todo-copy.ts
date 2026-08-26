/**
 * TO-DO dashboard copy — the single source of truth for the user-facing strings
 * that turn the contract list into a work queue (urgency labels, next-action
 * copy, the pending-signer line, and the summary-card titles).
 *
 * Source of truth: design-spec/messaging/todo-copy.md, which extends the project
 * base voice (design-spec/messaging/recording.md): 해요체, no blame, always give
 * the next action, and stay calm (never manufacture urgency/countdowns). Per base
 * voice principle 6, every user-facing string lives in one place (`lib/*-copy.ts`)
 * so it stays consistent and auditable — components take these as props and never
 * own the wording themselves.
 *
 * Locale: every accessor here takes `locale: 'ko' | 'en'` and returns the catalog
 * for that locale (the standard adopted in messaging/locale-copy-convention.md,
 * mirroring `signerCopyFor` / `completionDownloadCopyFor`). The Korean catalog is
 * the `as const` base (single source of tone); the English branch is type-checked
 * against its widened shape, so a missing/misshapen English key is a compile error.
 */

import { copyForLocale, type SupportedCopyLocale } from './copy-locale';
import type { NextAction, Urgency } from './documents';
import type { DashboardSummaryCopy } from '@/components/dashboard-summary';
import type { ViewSwitcherCopy } from '@/components/view-switcher';
import type { KanbanBoardCopy } from '@/components/kanban-board';

/**
 * Urgency labels — shared verbatim by the UrgencyBadge and the summary cards so
 * the same urgency reads with the same word across the dashboard
 * (todo-copy.md "Urgency 라벨"). NORMAL carries no label (no badge is rendered).
 * Keyed by locale so the badge reads in the resolved language.
 */
const URGENCY_LABEL: Record<
  SupportedCopyLocale,
  Record<Exclude<Urgency, 'NORMAL'>, string>
> = {
  ko: { OVERDUE: '기한 초과', DUE_SOON: '마감 임박' },
  en: { OVERDUE: 'Overdue', DUE_SOON: 'Due soon' },
};

/** The urgency label for a badge; empty for NORMAL (badge renders nothing then). */
export function urgencyLabel(urgency: Urgency, locale: SupportedCopyLocale): string {
  return urgency === 'NORMAL' ? '' : URGENCY_LABEL[locale][urgency];
}

/**
 * NextAction copy (todo-copy.md "NextAction 버튼/라벨 카피"). `cta` actions are
 * value-carrying verb phrases (the primary next step); `status` is a passive
 * state label with no owner action to take right now — we do NOT invent a
 * "remind/nudge" action for it (automated reminders are out of PLAN scope).
 * `CANCELLED` maps to `null` (no next action) — no fake CTA is manufactured.
 */
export type NextActionKind = 'cta' | 'status';

export interface NextActionCopy {
  label: string;
  kind: NextActionKind;
}

/**
 * `kind` is locale-invariant (it drives styling, not wording) — only `label`
 * branches by locale, so the two catalogs stay in lockstep by construction.
 */
const NEXT_ACTION_COPY: Record<SupportedCopyLocale, Record<NextAction, NextActionCopy>> = {
  ko: {
    SEND_DRAFT: { label: '발송하기', kind: 'cta' },
    AWAITING_SIGN: { label: '서명 대기 중', kind: 'status' },
    DOWNLOAD: { label: '내려받기', kind: 'cta' },
  },
  en: {
    SEND_DRAFT: { label: 'Send', kind: 'cta' },
    AWAITING_SIGN: { label: 'Awaiting signature', kind: 'status' },
    DOWNLOAD: { label: 'Download', kind: 'cta' },
  },
};

/** The card's next-action copy, or `null` when there is none (CANCELLED). */
export function nextActionCopy(
  action: NextAction | null,
  locale: SupportedCopyLocale,
): NextActionCopy | null {
  return action ? NEXT_ACTION_COPY[locale][action] : null;
}

/**
 * Pending-signer line (todo-copy.md "pendingSignerCount 표현 카피"): the short
 * form `서명 대기 {N}명`, aligned with the existing `받는 분 {N}명` meta wording.
 * `null` at 0 so the caller omits the line entirely (no "0명 대기" noise).
 */
export function pendingSignerLabel(count: number, locale: SupportedCopyLocale): string | null {
  if (count <= 0) return null;
  return locale === 'ko' ? `서명 대기 ${count}명` : `${count} awaiting signature`;
}

/**
 * Summary-card titles + count unit (todo-copy.md "요약 카드 카피"). Titles reuse
 * the urgency vocabulary (기한 초과 / 마감 임박) plus "서명 대기 중" (the
 * IN_PROGRESS superset); the count unit is "건" (aligned with the contract domain).
 */
const SUMMARY_COPY_KO = {
  title: {
    OVERDUE: '기한 초과',
    DUE_SOON: '마감 임박',
    AWAITING: '서명 대기 중',
  },
  countUnit: '건',
} as const;

/** Summary-card copy in the locale resolved for the dashboard. */
export const summaryCopyFor = copyForLocale<typeof SUMMARY_COPY_KO>(SUMMARY_COPY_KO, {
  title: {
    OVERDUE: 'Overdue',
    DUE_SOON: 'Due soon',
    AWAITING: 'Awaiting signature',
  },
  // Count unit is joined as `${count}${countUnit}`; the leading space keeps the
  // English screen-reader label readable ("Overdue 3 items").
  countUnit: ' items',
}) satisfies (locale: SupportedCopyLocale) => DashboardSummaryCopy;

/**
 * Shown when a summary-card filter is active but no contract matches it (e.g. a
 * 0-count card is selected). Base voice: state it calmly and give the next action
 * (clear the filter) — not "아직 계약이 없어요", which would be wrong when
 * contracts exist but none match the current filter.
 */
const FILTERED_EMPTY_COPY_KO = {
  message: '이 조건에 해당하는 계약이 없어요.',
  clear: '전체 보기',
} as const;

/** Filtered-empty-state copy in the locale resolved for the dashboard. */
export const filteredEmptyCopyFor = copyForLocale<typeof FILTERED_EMPTY_COPY_KO>(
  FILTERED_EMPTY_COPY_KO,
  {
    message: 'No contracts match this filter.',
    clear: 'Show all',
  },
);

/**
 * View switcher labels (todo-copy.md "뷰 전환 라벨"). The dashboard shows its
 * contracts as a TO-DO 목록 (list) or a 칸반 (kanban) board; the ViewSwitcher takes
 * these as props so it never owns the wording. `groupLabel` names the control for
 * screen readers. Plain nouns, aligned with the calm base voice — no verbs/urgency.
 */
const VIEW_SWITCHER_COPY_KO = {
  label: {
    list: '목록',
    kanban: '칸반',
  },
  groupLabel: '뷰 전환',
} as const;

/** View-switcher copy in the locale resolved for the dashboard. */
export const viewSwitcherCopyFor = copyForLocale<typeof VIEW_SWITCHER_COPY_KO>(
  VIEW_SWITCHER_COPY_KO,
  {
    label: {
      list: 'List',
      kanban: 'Kanban',
    },
    groupLabel: 'Switch view',
  },
) satisfies (locale: SupportedCopyLocale) => ViewSwitcherCopy;

/**
 * Kanban board copy (todo-copy.md "칸반 컬럼 라벨"). Column headers reuse the
 * project's established status vocabulary — 작성 중 / 진행 중 / 완료됨 / 취소됨,
 * the same words as the server's DOCUMENT_STATUS_LABEL and the StatusBadge — so a
 * status reads with the same word on every screen (base voice: never say a state
 * differently per screen). `countUnit` "건" matches the summary cards; the empty-
 * column line states calmly that the column has nothing, giving no false urgency.
 */
const KANBAN_BOARD_COPY_KO = {
  columnLabel: {
    DRAFT: '작성 중',
    IN_PROGRESS: '진행 중',
    COMPLETED: '완료됨',
    CANCELLED: '취소됨',
  },
  countUnit: '건',
  emptyColumn: '이 상태의 계약이 없어요.',
  boardLabel: '칸반 보드',
} as const;

/** Kanban-board copy in the locale resolved for the dashboard. */
export const kanbanBoardCopyFor = copyForLocale<typeof KANBAN_BOARD_COPY_KO>(
  KANBAN_BOARD_COPY_KO,
  {
    columnLabel: {
      DRAFT: 'Draft',
      IN_PROGRESS: 'In progress',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
    },
    // See summaryCopyFor: leading space keeps `${count}${countUnit}` readable.
    countUnit: ' items',
    emptyColumn: 'No contracts in this status.',
    boardLabel: 'Kanban board',
  },
) satisfies (locale: SupportedCopyLocale) => KanbanBoardCopy;

/**
 * Every locale-branched copy surface this module owns, exposed as `{ ko, en }`
 * catalog pairs so the ko/en key-parity gate (todo-copy.test.ts) can assert full
 * structural parity without reaching into module internals.
 */
export const TODO_COPY_CATALOGS = {
  urgencyLabel: URGENCY_LABEL,
  nextAction: NEXT_ACTION_COPY,
  summary: { ko: summaryCopyFor('ko'), en: summaryCopyFor('en') },
  filteredEmpty: { ko: filteredEmptyCopyFor('ko'), en: filteredEmptyCopyFor('en') },
  viewSwitcher: { ko: viewSwitcherCopyFor('ko'), en: viewSwitcherCopyFor('en') },
  kanban: { ko: kanbanBoardCopyFor('ko'), en: kanbanBoardCopyFor('en') },
} as const;
