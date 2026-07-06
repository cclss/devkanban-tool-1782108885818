'use client';

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { AI_COPY } from '@/lib/ai-copy';
import { AiSuggestionBadge } from '@/components/ai/ai-suggestion-badge';

/**
 * PremiumAiPrompt — the non-intrusive callout that offers the premium AI on a
 * scanned document, or the upgrade path once free trials run out (grain-7).
 *
 * It is an inline banner, deliberately *not* a blocking modal: the editor stays
 * fully usable behind it, so a sender who ignores the prompt can just place
 * fields by hand. It speaks with the premium-AI visual language — a solid
 * `AiSuggestionBadge` over the violet `ai-accent` tint (design-spec token-group
 * `ai-accent`, component `premium-ai-prompt`) — and always offers an equal
 * "place fields by hand" escape next to the premium action, never a single
 * take-it path (messaging/ai-copy.md: 거절 경로를 항상 동등하게 제공).
 *
 * Three content modes over one structure (copy differs, layout / token language
 * identical — a "mode", not a Variant, per design-spec `premium-ai-prompt`):
 *   • invite  — "스캔한 문서 같아요…" + optional "무료 체험 N번 남음", with
 *               [프리미엄 AI로 찾기] / [직접 배치할게요].
 *   • boost   — text PDF the base engine handled; the *optional* accuracy booster.
 *               "서명란은 지금도 무제한으로…" + optional "무료 체험 N번 남음", with
 *               [프리미엄 AI로 더 정확하게] / [이대로 괜찮아요].
 *   • upgrade — "무료 체험을 모두 사용했어요…", with
 *               [플랜 업그레이드] / [직접 배치하기].
 *
 * All strings come from the central `AI_COPY`; this component owns none of the
 * words.
 */
export interface PremiumAiPromptProps {
  mode: 'invite' | 'boost' | 'upgrade';
  /** Remaining free trials — shown on the invite for non-premium accounts. */
  trialsRemaining?: number;
  /** Whether to render the "무료 체험 N번 남음" note (hidden for premium plans). */
  showTrialCount?: boolean;
  /** The premium action is running (re-requesting analysis / routing). */
  busy?: boolean;
  /** Accept: run the premium AI (invite) or go to the plan upgrade (upgrade). */
  onAccept: () => void;
  /** Decline: dismiss and place fields manually (both modes). */
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
  upgrade: {
    headline: AI_COPY.upgrade.depleted,
    accept: AI_COPY.upgrade.upgradePlan,
    dismiss: AI_COPY.upgrade.placeManually,
  },
};

export function PremiumAiPrompt({
  mode,
  trialsRemaining = 0,
  showTrialCount = false,
  busy = false,
  onAccept,
  onDismiss,
  className,
}: PremiumAiPromptProps) {
  const headlineId = React.useId();
  // Both invites carry the "무료 체험 N번 남음" note; only the upgrade mode omits it.
  const isUpgrade = mode === 'upgrade';
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
        {!isUpgrade && showTrialCount ? (
          <p className="text-xs font-medium text-ai-strong/80">
            {AI_COPY.trial.remaining(trialsRemaining)}
          </p>
        ) : null}
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
