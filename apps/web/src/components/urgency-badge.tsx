import type { ReactElement } from 'react';
import { cn } from '@repo/ui';
import type { Urgency } from '@/lib/documents';

/**
 * UrgencyBadge — how time-pressured a contract is *today*, shown next to the
 * StatusBadge on document cards/lists. It rides on a separate axis from the
 * lifecycle StatusBadge (see design-spec/components/urgency-badge/base.md).
 *
 * Design decisions (design-spec):
 * - Tone map (grain-1/M2): OVERDUE → danger "기한 초과", DUE_SOON → warning
 *   "마감 임박", NORMAL → no badge at all (no time pressure, keep visual noise
 *   down — the StatusBadge alone carries the state). So this renders `null` for
 *   NORMAL.
 * - Accessibility (never color alone): each tone leads with a *shape-different*
 *   icon so OVERDUE↔DUE_SOON are distinguishable by form (not just red↔orange,
 *   which sit close for some color vision) — an alert triangle for OVERDUE, a
 *   clock for DUE_SOON — and the Korean label is always present.
 * - AA on tinted backgrounds: tinted text can fail WCAG AA (see StatusBadge's
 *   recorded green-on-success-subtle failure), so the label text stays dark
 *   (`foreground-muted`) and the hue is carried by the icon over a subtle tint.
 *
 * The `label` comes from the caller (the copy source of truth is
 * design-spec/messaging/todo-copy.md — "기한 초과" / "마감 임박"); it is unused
 * for NORMAL since nothing renders.
 */
type UrgentTone = Exclude<Urgency, 'NORMAL'>;

const TONE: Record<UrgentTone, { tint: string; icon: string; Icon: () => ReactElement }> = {
  OVERDUE: { tint: 'bg-danger-subtle', icon: 'text-danger', Icon: AlertTriangleIcon },
  DUE_SOON: { tint: 'bg-warning-subtle', icon: 'text-warning', Icon: ClockIcon },
};

export interface UrgencyBadgeProps {
  urgency: Urgency;
  /** Korean urgency label (from messaging/todo-copy.md). Ignored for NORMAL. */
  label: string;
  className?: string;
}

export function UrgencyBadge({ urgency, label, className }: UrgencyBadgeProps) {
  // NORMAL carries no time pressure → no badge (visual-noise minimization).
  if (urgency === 'NORMAL') return null;

  const tone = TONE[urgency];
  const { Icon } = tone;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2xs rounded-full px-xs py-2xs text-xs font-semibold text-foreground-muted',
        tone.tint,
        className,
      )}
    >
      <Icon />
      {label}
    </span>
  );
}

/** Alert triangle — the shape signal for OVERDUE (hue carried by `text-danger`). */
function AlertTriangleIcon() {
  return (
    <svg
      className={cn('h-3 w-3', TONE.OVERDUE.icon)}
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

/** Clock — the shape signal for DUE_SOON (hue carried by `text-warning`). */
function ClockIcon() {
  return (
    <svg
      className={cn('h-3 w-3', TONE.DUE_SOON.icon)}
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
