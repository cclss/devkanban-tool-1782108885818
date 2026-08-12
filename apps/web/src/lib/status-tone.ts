/**
 * Status → tone tokens (tint background / dot hue / label text) — the single map
 * for a contract's lifecycle color across the dashboard. Kept as pure data (no
 * React) so both the StatusBadge and the kanban column headers reuse the *same*
 * tone tokens: the same status reads with the same hue whether it's a badge or a
 * board column, and no color value is re-declared.
 *
 * Design decisions (design-spec/content/status-tone-scheduled.md,
 * design-spec/messaging/recording.md): the hue is carried by a colored dot over a
 * subtle tinted background while the label text stays dark — tinted status text
 * fails WCAG AA at this size, so color is never the sole signal (the Korean
 * status label is always present too).
 *
 * `SCHEDULED` uses the project's `warning` (amber) hue: within the semantic
 * palette (primary=진행 중, success=완료됨, grey=작성 중/취소됨, danger=오류)
 * amber is the calm "time / pending" signal for a contract queued to auto-send.
 * A SCHEDULED contract always derives NORMAL urgency (no UrgencyBadge), so the
 * amber status dot never collides with the amber 마감 임박 urgency mark on the
 * same card; dashboard-wide amber consistently means "time-sensitive".
 */

import type { DocumentStatus } from './documents';

export interface StatusTone {
  tint: string;
  dot: string;
  text: string;
}

export const STATUS_TONE: Record<DocumentStatus, StatusTone> = {
  DRAFT: { tint: 'bg-grey-100', dot: 'bg-grey-400', text: 'text-foreground-muted' },
  SCHEDULED: { tint: 'bg-warning-subtle', dot: 'bg-warning', text: 'text-foreground-muted' },
  IN_PROGRESS: { tint: 'bg-primary-subtle', dot: 'bg-primary', text: 'text-primary' },
  COMPLETED: { tint: 'bg-success-subtle', dot: 'bg-success', text: 'text-foreground-muted' },
  CANCELLED: { tint: 'bg-grey-100', dot: 'bg-grey-300', text: 'text-foreground-subtle' },
};
