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
 */

import type { NextAction, Urgency } from './documents';
import type { DashboardSummaryCopy } from '@/components/dashboard-summary';
import type { ViewSwitcherCopy } from '@/components/view-switcher';

/**
 * Urgency labels — shared verbatim by the UrgencyBadge and the summary cards so
 * the same urgency reads with the same word across the dashboard
 * (todo-copy.md "Urgency 라벨"). NORMAL carries no label (no badge is rendered).
 */
const URGENCY_LABEL: Record<Exclude<Urgency, 'NORMAL'>, string> = {
  OVERDUE: '기한 초과',
  DUE_SOON: '마감 임박',
};

/** The urgency label for a badge; empty for NORMAL (badge renders nothing then). */
export function urgencyLabel(urgency: Urgency): string {
  return urgency === 'NORMAL' ? '' : URGENCY_LABEL[urgency];
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

const NEXT_ACTION_COPY: Record<NextAction, NextActionCopy> = {
  SEND_DRAFT: { label: '발송하기', kind: 'cta' },
  AWAITING_SIGN: { label: '서명 대기 중', kind: 'status' },
  DOWNLOAD: { label: '내려받기', kind: 'cta' },
};

/** The card's next-action copy, or `null` when there is none (CANCELLED). */
export function nextActionCopy(action: NextAction | null): NextActionCopy | null {
  return action ? NEXT_ACTION_COPY[action] : null;
}

/**
 * Pending-signer line (todo-copy.md "pendingSignerCount 표현 카피"): the short
 * form `서명 대기 {N}명`, aligned with the existing `받는 분 {N}명` meta wording.
 * `null` at 0 so the caller omits the line entirely (no "0명 대기" noise).
 */
export function pendingSignerLabel(count: number): string | null {
  return count > 0 ? `서명 대기 ${count}명` : null;
}

/**
 * Summary-card titles + count unit (todo-copy.md "요약 카드 카피"). Titles reuse
 * the urgency vocabulary (기한 초과 / 마감 임박) plus "서명 대기 중" (the
 * IN_PROGRESS superset); the count unit is "건" (aligned with the contract domain).
 */
export const SUMMARY_COPY: DashboardSummaryCopy = {
  title: {
    OVERDUE: '기한 초과',
    DUE_SOON: '마감 임박',
    AWAITING: '서명 대기 중',
  },
  countUnit: '건',
};

/**
 * Shown when a summary-card filter is active but no contract matches it (e.g. a
 * 0-count card is selected). Base voice: state it calmly and give the next action
 * (clear the filter) — not "아직 계약이 없어요", which would be wrong when
 * contracts exist but none match the current filter.
 */
export const FILTERED_EMPTY_COPY = {
  message: '이 조건에 해당하는 계약이 없어요.',
  clear: '전체 보기',
};

/**
 * View switcher labels (todo-copy.md "뷰 전환 라벨"). The dashboard shows its
 * contracts as a TO-DO 목록 (list) or a 칸반 (kanban) board; the ViewSwitcher takes
 * these as props so it never owns the wording. `groupLabel` names the control for
 * screen readers. Plain nouns, aligned with the calm base voice — no verbs/urgency.
 */
export const VIEW_SWITCHER_COPY: ViewSwitcherCopy = {
  label: {
    list: '목록',
    kanban: '칸반',
  },
  groupLabel: '뷰 전환',
};

/**
 * Temporary copy for the kanban mount point until grain-2 renders the actual
 * board (status columns 초안/진행 중/완료). Centralized here — rather than
 * hardcoded in the page — so the switch-target has no stray user-facing string;
 * grain-2 replaces this whole placeholder. Base voice: calm, states what's coming
 * without hype or urgency.
 */
export const KANBAN_PLACEHOLDER_COPY = {
  message: '칸반 보드가 곧 여기에 표시돼요.',
};
