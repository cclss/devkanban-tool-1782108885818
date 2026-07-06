'use client';

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { AI_COPY } from '@/lib/ai-copy';
import { AiSuggestionBadge } from '@/components/ai/ai-suggestion-badge';

/**
 * PremiumAiPrompt — the non-intrusive callout that offers the premium AI on a
 * scanned document, or as an optional accuracy boost on a text PDF.
 *
 * It is an inline banner, deliberately *not* a blocking modal: the editor stays
 * fully usable behind it, so a sender who ignores the prompt can just place
 * fields by hand. It speaks with the premium-AI visual language — a solid
 * `AiSuggestionBadge` over the violet `ai-accent` tint (design-spec token-group
 * `ai-accent`, component `premium-ai-prompt`) — and always offers an equal
 * "keep it / place by hand" escape next to the premium action, never a single
 * take-it path (messaging/ai-copy.md: 거절 경로를 항상 동등하게 제공).
 *
 * Premium AI is unlimited on every plan (2026-07-06 decision), so there is no
 * trial count and no upgrade wall — just a consent invite. Two content modes over
 * one structure (copy differs, layout / token language identical — a "mode", not
 * a Variant, per design-spec `premium-ai-prompt`):
 *   • invite  — "스캔한 문서 같아요…", with [AI로 서명란 찾기] / [직접 배치할게요].
 *   • boost   — text PDF the base engine handled; the *optional* accuracy booster.
 *               "서명란은 지금도 무제한으로…", with [AI로 더 정확하게] / [이대로 괜찮아요].
 *
 * All strings come from the central `AI_COPY`; this component owns none of the
 * words.
 */
export interface PremiumAiPromptProps {
  mode: 'invite' | 'boost';
  /** The premium action is running (re-requesting analysis). */
  busy?: boolean;
  /** Accept: run the premium AI. */
  onAccept: () => void;
  /** Decline: dismiss and keep the current placement / place by hand. */
  onDismiss: () => void;
  className?: string;
}

/** Per-mode copy: same structure, different words (design-spec "mode"). */
const MODE_COPY: Record<
  PremiumAiPromptProps['mode'],
  { headline: string; accept: string; dismiss: string }
> = {
  invite: {
    headline: AI_COPY.trial.scannedInvite,
    accept: AI_COPY.trial.accept,
    dismiss: AI_COPY.trial.declineManual,
  },
  boost: {
    headline: AI_COPY.trial.boostInvite,
    accept: AI_COPY.trial.boostAccept,
    dismiss: AI_COPY.trial.boostDecline,
  },
};

export function PremiumAiPrompt({
  mode,
  busy = false,
  onAccept,
  onDismiss,
  className,
}: PremiumAiPromptProps) {
  const headlineId = React.useId();
  const copy = MODE_COPY[mode];
  const headline = copy.headline;
  const acceptLabel = copy.accept;
  const dismissLabel = copy.dismiss;

  return (
    <section
      aria-labelledby={headlineId}
      className={cn(
        'flex flex-col gap-sm rounded-lg border border-ai/30 bg-ai-subtle px-md py-sm',
        className,
      )}
    >
      <div className="flex flex-col gap-2xs">
        <AiSuggestionBadge tone="solid" className="self-start" />
        <p id={headlineId} className="text-sm font-semibold text-ai-strong">
          {headline}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          aria-busy={busy || undefined}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-xs rounded-md px-md text-sm font-semibold',
            'bg-ai text-ai-foreground transition-[transform,background-color] duration-fast ease-standard',
            'hover:bg-ai-strong active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          {acceptLabel}
        </button>
        <Button variant="secondary" size="sm" onClick={onDismiss} disabled={busy}>
          {dismissLabel}
        </Button>
      </div>
    </section>
  );
}
