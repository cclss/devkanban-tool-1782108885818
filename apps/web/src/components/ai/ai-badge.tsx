import { cn } from '@repo/ui';

/**
 * AiBadge — a provenance marker that tags a piece of UI as AI-generated.
 *
 * Pure presentation: a sparkle glyph + a short label ("AI 제안") on the AI
 * accent treatment (`accent-ai`), kept visually distinct from the status hues
 * (primary / success / danger / warning) so AI provenance never reads as a
 * lifecycle state. The label text is always present, so the meaning survives for
 * users who can't perceive the accent color (the glyph is decorative only).
 *
 * Shared by the desktop wizard and the mobile signer flow. Owns no state.
 */
export interface AiBadgeProps {
  /** Visible label. Defaults to the feature's standard "AI 제안". */
  label?: string;
  /** `sm` for inline/dense placement, `md` (default) for standalone use. */
  size?: 'sm' | 'md';
  className?: string;
}

export function AiBadge({ label = 'AI 제안', size = 'md', className }: AiBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2xs rounded-full font-semibold',
        'bg-accent-ai-subtle text-accent-ai',
        size === 'sm' ? 'px-2xs py-2xs text-2xs' : 'px-xs py-2xs text-xs',
        className,
      )}
    >
      <SparkleGlyph className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {label}
    </span>
  );
}

/** Four-point sparkle — the shared AI glyph. Decorative; the label carries meaning. */
export function SparkleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M8 1.5c.3 2.4 1.6 3.7 4 4-2.4.3-3.7 1.6-4 4-.3-2.4-1.6-3.7-4-4 2.4-.3 3.7-1.6 4-4Z"
        fill="currentColor"
      />
      <path
        d="M13 9c.15 1.2.8 1.85 2 2-1.2.15-1.85.8-2 2-.15-1.2-.8-1.85-2-2 1.2-.15 1.85-.8 2-2Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}
