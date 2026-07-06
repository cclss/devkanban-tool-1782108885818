import { cn } from '@repo/ui';
import { AI_COPY } from '@/lib/ai-copy';

/**
 * AiSuggestionBadge — the shared indicator that marks something as AI-suggested.
 *
 * Design decision (recorded in design-spec: token-group `ai-accent`, component
 * `ai-suggestion-badge`): AI-generated content carries the violet `ai` accent so
 * it reads as distinct from manual work (grey/`primary` blue) and from status
 * hues. Following the same accessibility rule as `StatusBadge`, colour is never
 * the only signal — a sparkle glyph and a Korean label (`AI 추천`) always ride
 * with the tint. Both tones clear WCAG AA (see `globals.css`).
 *
 * Two tones:
 *   - `subtle` (default) — tinted pill for inline / on-canvas use (e.g. a marker
 *     pinned to an AI-suggested field, a header note).
 *   - `solid` — filled pill for stronger emphasis (e.g. the premium-AI banner).
 */
export interface AiSuggestionBadgeProps {
  tone?: 'subtle' | 'solid';
  /** Override the default `AI 추천` label. */
  label?: string;
  className?: string;
}

const TONE: Record<NonNullable<AiSuggestionBadgeProps['tone']>, string> = {
  subtle: 'bg-ai-subtle text-ai-strong',
  solid: 'bg-ai text-ai-foreground',
};

export function AiSuggestionBadge({
  tone = 'subtle',
  label = AI_COPY.badge,
  className,
}: AiSuggestionBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2xs rounded-full px-xs py-2xs text-xs font-semibold',
        TONE[tone],
        className,
      )}
    >
      <SparkleGlyph />
      {label}
    </span>
  );
}

/** Four-point sparkle — the shared "AI / magic" mark for this accent. */
function SparkleGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M8 1.5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5Z"
        fill="currentColor"
      />
      <path d="M13 10.5c.15 1 .7 1.55 1.7 1.7-1 .15-1.55.7-1.7 1.7-.15-1-.7-1.55-1.7-1.7 1-.15 1.55-.7 1.7-1.7Z" fill="currentColor" />
    </svg>
  );
}
