'use client';

import * as React from 'react';
import { cn } from '@repo/ui';
import type { ViewMode } from '@/lib/view-mode';

/**
 * ViewSwitcher — the reusable segmented control that flips the dashboard between
 * its TO-DO **list** and **kanban** views (design-spec
 * `components/view-switcher/base.md`). It is a pure, controlled presentation
 * component: the parent owns the selected `value` and the switch is a plain
 * conditional render, so toggling views never touches the loaded data, active
 * filter, or scroll position (context is preserved — see dashboard/page.tsx).
 *
 * Design decisions (design-spec):
 * - Single-select segmented control → radiogroup semantics: `role="radiogroup"`
 *   wraps `role="radio"` segments with `aria-checked`, and focus roves with the
 *   arrow keys (roving tabindex). This is the accessible pattern for choosing one
 *   option from a small, always-visible set.
 * - Never color alone (accessibility, shared with summary-card): the active
 *   segment is signalled by *form* as well as hue — a filled primary-subtle chip
 *   and a heavier font weight — not color by itself. The `primary-subtle` /
 *   `text-primary` pair is the dashboard's AA-verified "actionable = primary"
 *   language (same as the SEND_DRAFT CTA pill and status-badge 진행 중).
 *
 * This component owns structure/tone/interaction but NOT copy: the Korean segment
 * labels come in via `copy` (single source of truth:
 * design-spec/messaging/todo-copy.md "뷰 전환 라벨"), exactly like DashboardSummary
 * and UrgencyBadge take their strings as props.
 */

/** Render order of the segments (left → right). `list` is the default view. */
const VIEW_ORDER: readonly ViewMode[] = ['list', 'kanban'];

/**
 * Segment labels, injected so the component never owns user-facing strings
 * (source of truth: design-spec/messaging/todo-copy.md).
 */
export interface ViewSwitcherCopy {
  /** Label per view, e.g. `{ list: '목록', kanban: '칸반' }`. */
  label: Record<ViewMode, string>;
  /**
   * Accessible name for the whole control (the radiogroup), e.g. "뷰 전환".
   * Keeps the segment buttons from being an unlabeled group for screen readers.
   */
  groupLabel: string;
}

export interface ViewSwitcherProps {
  /** The active view (controlled by the parent — page state lives there). */
  value: ViewMode;
  /** Called with the newly chosen view when a segment is activated. */
  onChange: (value: ViewMode) => void;
  /** Segment + group labels (source: messaging/todo-copy.md). */
  copy: ViewSwitcherCopy;
  className?: string;
}

export function ViewSwitcher({ value, onChange, copy, className }: ViewSwitcherProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Roving focus: Arrow keys move selection (and focus) between segments, wrapping
  // at the ends — the standard radiogroup keyboard model.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const delta = forward ? 1 : -1;
    const next = (index + delta + VIEW_ORDER.length) % VIEW_ORDER.length;
    const nextView = VIEW_ORDER[next];
    if (!nextView) return;
    onChange(nextView);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={copy.groupLabel}
      className={cn(
        'inline-flex items-center gap-2xs rounded-lg border border-border bg-surface p-2xs',
        className,
      )}
    >
      {VIEW_ORDER.map((view, index) => {
        const active = view === value;
        return (
          <button
            key={view}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: only the active segment is in the tab order; arrows
            // reach the rest.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(view)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'rounded-md px-sm py-2xs text-sm transition-colors duration-fast ease-standard',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
              active
                ? 'bg-primary-subtle font-semibold text-primary'
                : 'font-medium text-foreground-subtle hover:bg-surface-muted hover:text-foreground',
            )}
          >
            {copy.label[view]}
          </button>
        );
      })}
    </div>
  );
}
