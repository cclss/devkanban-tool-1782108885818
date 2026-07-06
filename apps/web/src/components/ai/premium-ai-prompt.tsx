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
 * Two content modes over one structure:
 *   • invite  — "스캔한 문서 같아요…" + optional "무료 체험 N번 남음", with
 *               [프리미엄 AI로 찾기] / [직접 배치할게요].
 *   • upgrade — "무료 체험을 모두 사용했어요…", with
 *               [플랜 업그레이드] / [직접 배치하기].
 *
 * All strings come from the central `AI_COPY`; this component owns none of the
 * words.
 */
export interface PremiumAiPromptProps {
  mode: 'invite' | 'upgrade';
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
  const isInvite = mode === 'invite';
  const headline = isInvite ? AI_COPY.trial.scannedInvite : AI_COPY.upgrade.depleted;
  const acceptLabel = isInvite ? AI_COPY.trial.accept : AI_COPY.upgrade.upgradePlan;
  const dismissLabel = isInvite ? AI_COPY.trial.declineManual : AI_COPY.upgrade.placeManually;

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
        {isInvite && showTrialCount ? (
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
