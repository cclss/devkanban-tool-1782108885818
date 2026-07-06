import { cn } from '@repo/ui';
import type { DocumentStatus } from '@/lib/documents';

/**
 * StatusBadge — a contract's lifecycle state as a pill.
 *
 * Design decision (recorded in design-spec/messaging/recording.md): the hue is
 * carried by a leading colored dot over a subtle tinted background, while the
 * label text stays dark (`foreground-muted`). Tinted status text — green on
 * `success-subtle` especially — fails WCAG AA at this size, so color is conveyed
 * by the dot (never color alone: the Korean label is always present). The label
 * itself comes from the server (`statusLabel`), the single source of truth.
 */
const TONE: Record<DocumentStatus, { tint: string; dot: string; text: string }> = {
  IN_PROGRESS: { tint: 'bg-primary-subtle', dot: 'bg-primary', text: 'text-primary' },
  COMPLETED: { tint: 'bg-success-subtle', dot: 'bg-success', text: 'text-foreground-muted' },
  DRAFT: { tint: 'bg-grey-100', dot: 'bg-grey-400', text: 'text-foreground-muted' },
  CANCELLED: { tint: 'bg-grey-100', dot: 'bg-grey-300', text: 'text-foreground-subtle' },
};

export interface StatusBadgeProps {
  status: DocumentStatus;
  label: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const tone = TONE[status] ?? TONE.DRAFT;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2xs rounded-full px-xs py-2xs text-xs font-semibold',
        tone.tint,
        tone.text,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      {label}
    </span>
  );
}
