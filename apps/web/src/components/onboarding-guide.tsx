'use client';

import { Button, Card, cn } from '@repo/ui';
import type { OnboardingStep } from '@/lib/onboarding-copy';

/**
 * OnboardingGuide — the first-run welcome guide that walks a brand-new user
 * (zero real contracts) through creating their first contract: a numbered
 * ①업로드 ②서명 요청 ③완료 추적 walkthrough plus one primary CTA that starts a
 * real contract.
 *
 * Design decisions (design-spec/components/onboarding-guide/base.md):
 * - Visual language is shared with the dashboard's EmptyState and summary cards
 *   (same `Card` surface, spacing, typography, tone): heading in
 *   `text-lg font-bold text-foreground`, lead/step body in `text-foreground-subtle`,
 *   and a single `size="lg"` primary Button — so the guide reads as part of the
 *   same dashboard, not a foreign overlay.
 * - Each step's number badge reuses the existing `bg-primary-subtle text-primary`
 *   round chip (the same token pairing the dashboard already uses for the
 *   document icon and the SEND_DRAFT CTA pill) — no new tokens, no hardcoded
 *   colors. Steps render in an `<ol>` so their order is conveyed semantically;
 *   the visual number is `aria-hidden` to avoid a double read.
 * - Pure presentation: the component owns structure/tone but NOT the wording —
 *   `title`, `description`, `steps`, and `ctaLabel` are all injected (single
 *   source of truth: design-spec/messaging + `lib/onboarding-copy.ts`), exactly
 *   like UrgencyBadge/DashboardSummary take their copy as props. It holds no
 *   gating or persistence logic (that is the dashboard's job in a later grain);
 *   it just renders and calls `onCreate` on the CTA.
 */
export interface OnboardingGuideProps {
  /** Guide heading (source: onboarding-copy.ts). */
  title: string;
  /** One-line lead under the heading. */
  description: string;
  /** The ordered walkthrough steps (①업로드 ②서명 요청 ③완료 추적). */
  steps: OnboardingStep[];
  /** Primary CTA label; clicking it calls {@link onCreate}. */
  ctaLabel: string;
  /** Start the first real contract. */
  onCreate: () => void;
  className?: string;
}

export function OnboardingGuide({
  title,
  description,
  steps,
  ctaLabel,
  onCreate,
  className,
}: OnboardingGuideProps) {
  return (
    <Card className={cn('flex flex-col gap-lg p-lg', className)}>
      <div className="flex flex-col gap-2xs">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-base text-foreground-subtle">{description}</p>
      </div>

      <ol className="flex flex-col gap-md">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-start gap-sm">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-sm font-bold tabular-nums text-primary"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-2xs">
              <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
              <p className="text-sm text-foreground-subtle">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      <Button size="lg" onClick={onCreate} className="sm:w-auto sm:self-start">
        {ctaLabel}
      </Button>
    </Card>
  );
}
