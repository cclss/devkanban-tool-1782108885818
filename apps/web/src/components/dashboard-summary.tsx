'use client';

import * as React from 'react';
import type { ReactElement } from 'react';
import { Card, cn } from '@repo/ui';
import type { DocumentSummary } from '@/lib/documents';

/**
 * DashboardSummary — the three "오늘의 할 일" summary + filter cards at the top of
 * the dashboard (design-spec `components/summary-card/base.md`). It turns the
 * contract list from a passive file list into a work queue: each card counts the
 * documents in one urgency group and, when clicked, filters the list below to
 * that group (M2 core UX).
 *
 * Design decisions (design-spec):
 * - Classification (summary-card/base.md): the "처리 필요" axis is split into
 *   three *filter predicates* (NOT a mutually-exclusive partition):
 *     · 기한 초과   → urgency === 'OVERDUE'          (danger,  hierarchy 1, strongest)
 *     · 마감 임박   → urgency === 'DUE_SOON'         (warning, hierarchy 2)
 *     · 서명 대기 중 → nextAction === 'AWAITING_SIGN' (neutral, hierarchy 3, superset)
 *   "서명 대기 중" is the superset of every IN_PROGRESS contract, so a single
 *   document is intentionally counted by both "기한 초과" and "서명 대기 중". The
 *   predicates live in {@link SUMMARY_FILTERS} so the page can reuse the exact
 *   same predicate to filter the list — guaranteeing the DoD invariant
 *   "card count === filtered list count".
 * - Hierarchy & tone: order and emphasis follow urgency — danger > warning >
 *   neutral — and the tone map is *shared with UrgencyBadge* so the same color +
 *   shape means the same thing across the whole dashboard (a card's danger mark =
 *   a document card's danger badge = 기한 초과).
 * - Never color alone (accessibility): each card pairs its label text with a
 *   tone mark whose *shape* differs (alert triangle for OVERDUE, clock for
 *   DUE_SOON, a neutral dot for AWAITING) — the same glyphs UrgencyBadge fixed in
 *   grain-3. The hue rides on the mark only; the big count stays dark
 *   (`foreground`) so it never depends on a tinted-text contrast that could miss
 *   WCAG AA (warning-on-white in particular).
 * - Zero counts are de-emphasized (`foreground-subtle`) but never hidden — "0건"
 *   ("nothing urgent right now") is information too.
 * - Selected (filter-active) state is a real toggle: `aria-pressed` semantics
 *   plus a *form* signal (an emphasized ring), not color alone.
 *
 * This component owns structure/hierarchy/tone but NOT copy: the Korean titles
 * and the count-unit noun come in via `copy` (single source of truth:
 * design-spec/messaging/todo-copy.md "요약 카드 카피"), exactly like UrgencyBadge
 * takes its label as a prop. It also owns no page state or data fetching — counts
 * derive from the `documents` prop and selection is controlled by the parent.
 */

export type SummaryFilterKey = 'OVERDUE' | 'DUE_SOON' | 'AWAITING';

/**
 * The filter predicate for each summary card — the single source of truth for
 * both a card's count and the list filtering it drives, so "card count ===
 * filtered list count" holds by construction. The page should filter its list
 * with `documents.filter(SUMMARY_FILTERS[selected])`.
 */
export const SUMMARY_FILTERS: Record<
  SummaryFilterKey,
  (document: DocumentSummary) => boolean
> = {
  OVERDUE: (d) => d.urgency === 'OVERDUE',
  DUE_SOON: (d) => d.urgency === 'DUE_SOON',
  // "서명 대기 중" is the IN_PROGRESS superset (every awaiting-signature contract).
  AWAITING: (d) => d.nextAction === 'AWAITING_SIGN',
};

/** Render order = urgency hierarchy (danger > warning > neutral). */
const CARD_ORDER: readonly SummaryFilterKey[] = ['OVERDUE', 'DUE_SOON', 'AWAITING'];

/**
 * Copy for the three cards. Injected so the component never owns user-facing
 * strings (source of truth: design-spec/messaging/todo-copy.md).
 */
export interface DashboardSummaryCopy {
  /** Card title per group, e.g. `{ OVERDUE: '기한 초과', ... }`. */
  title: Record<SummaryFilterKey, string>;
  /** Count-unit noun for the screen-reader label, e.g. "건" → "기한 초과 3건". */
  countUnit: string;
}

/**
 * Tone map, shared with UrgencyBadge (same color = same meaning dashboard-wide).
 * The subtle tint chip carries the hue via its mark; card text stays dark.
 */
const TONE: Record<SummaryFilterKey, { chip: string; mark: string; Mark: () => ReactElement }> = {
  OVERDUE: { chip: 'bg-danger-subtle', mark: 'text-danger', Mark: AlertTriangleMark },
  DUE_SOON: { chip: 'bg-warning-subtle', mark: 'text-warning', Mark: ClockMark },
  AWAITING: { chip: 'bg-grey-100', mark: 'text-foreground-subtle', Mark: NeutralDotMark },
};

export interface DashboardSummaryProps {
  /** The sender's contracts; counts derive from these via {@link SUMMARY_FILTERS}. */
  documents: DocumentSummary[];
  /** Card titles + count unit (source: messaging/todo-copy.md). */
  copy: DashboardSummaryCopy;
  /** The active filter, or `null` when the list is unfiltered. */
  selected?: SummaryFilterKey | null;
  /**
   * Toggle a card's filter. Called with the card's key, or `null` when the
   * already-selected card is clicked again (clears the filter). Omit to render
   * the cards as static (non-interactive) summaries. Page state is the parent's.
   */
  onSelect?: (key: SummaryFilterKey | null) => void;
  className?: string;
}

export function DashboardSummary({
  documents,
  copy,
  selected = null,
  onSelect,
  className,
}: DashboardSummaryProps) {
  const counts = React.useMemo(
    () =>
      ({
        OVERDUE: documents.filter(SUMMARY_FILTERS.OVERDUE).length,
        DUE_SOON: documents.filter(SUMMARY_FILTERS.DUE_SOON).length,
        AWAITING: documents.filter(SUMMARY_FILTERS.AWAITING).length,
      }) satisfies Record<SummaryFilterKey, number>,
    [documents],
  );

  return (
    <div className={cn('grid grid-cols-1 gap-sm sm:grid-cols-3', className)}>
      {CARD_ORDER.map((key) => (
        <SummaryCard
          key={key}
          filterKey={key}
          title={copy.title[key]}
          count={counts[key]}
          countUnit={copy.countUnit}
          selected={selected === key}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SummaryCard({
  filterKey,
  title,
  count,
  countUnit,
  selected,
  onSelect,
}: {
  filterKey: SummaryFilterKey;
  title: string;
  count: number;
  countUnit: string;
  selected: boolean;
  onSelect?: (key: SummaryFilterKey | null) => void;
}) {
  const tone = TONE[filterKey];
  const { Mark } = tone;
  const interactive = Boolean(onSelect);
  // SR label reads the group + count together: "기한 초과 3건".
  const srLabel = `${title} ${count}${countUnit}`;
  const empty = count === 0;

  const surface = (
    <Card
      interactive={interactive}
      className={cn(
        'flex h-full flex-col gap-xs p-lg text-left',
        // Selected = form signal (emphasized ring), not color alone; paired with
        // aria-pressed on the button below.
        selected && 'ring-2 ring-focus',
      )}
    >
      <div className="flex items-center gap-2xs">
        <span
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            tone.chip,
          )}
        >
          <Mark />
        </span>
        <span className="text-sm font-semibold text-foreground-muted">{title}</span>
      </div>
      {/* Hue rides on the mark; the count stays dark for AA. 0 is de-emphasized,
          never hidden. aria-hidden because the button's aria-label reads the
          count together with the title. */}
      <span
        className={cn(
          'text-3xl font-bold tabular-nums',
          empty ? 'text-foreground-subtle' : 'text-foreground',
        )}
        aria-hidden="true"
      >
        {count}
      </span>
    </Card>
  );

  if (!interactive) {
    return surface;
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={srLabel}
      onClick={() => onSelect?.(selected ? null : filterKey)}
      className="rounded-lg text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
    >
      {surface}
    </button>
  );
}

/**
 * Alert triangle — the OVERDUE shape signal (hue via `text-danger`). Glyph
 * matches UrgencyBadge's mark so the same urgency reads as the same shape across
 * the dashboard; it is re-declared here (not imported) because UrgencyBadge does
 * not export its icons and its internals are out of this grain's scope.
 */
function AlertTriangleMark() {
  return (
    <svg
      className={cn('h-4 w-4', TONE.OVERDUE.mark)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Clock — the DUE_SOON shape signal (hue via `text-warning`); matches UrgencyBadge. */
function ClockMark() {
  return (
    <svg
      className={cn('h-4 w-4', TONE.DUE_SOON.mark)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

/**
 * Neutral dot — the AWAITING (진행 중 superset) tone mark. UrgencyBadge has no
 * NORMAL/neutral mark (it renders nothing), so the neutral tone uses the
 * project's status-dot convention (a grey dot), keeping color off the sole-signal
 * path.
 */
function NeutralDotMark() {
  return <span className="h-1.5 w-1.5 rounded-full bg-grey-400" aria-hidden="true" />;
}
