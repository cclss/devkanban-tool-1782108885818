'use client';

/**
 * Contract-creation wizard shell.
 *
 * Owns the chrome shared across every step: a sticky header, the StepIndicator
 * (whose current node plays the `step-bounce` pop on each transition), the
 * animated content region, and the back/next footer. Step *content* lives in
 * slot components — only the upload step is built here (grain-6); field
 * placement (7), recipients (8) and review/send (9) fill their slots later.
 *
 * Navigation is centralized: a step never advances itself. It writes to wizard
 * state, and `canProceed()` decides whether "다음" unlocks — so as later grains
 * add their data, the gate lights up without touching this shell.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, StepIndicator } from '@repo/ui';
import {
  WizardProvider,
  useWizard,
  canProceed,
  WIZARD_STEPS,
  LAST_STEP,
} from './wizard-context';
import { UploadStep } from './upload-step';
import { FieldsStep } from './fields-step';
import { RecipientsStep } from './recipients-step';
import { ReviewStep } from './review-step';

export function ContractWizard() {
  return (
    <WizardProvider>
      <WizardShell />
    </WizardProvider>
  );
}

function WizardShell() {
  const router = useRouter();
  const { state, goNext, goBack } = useWizard();
  const proceed = canProceed(state);

  const exit = React.useCallback(() => router.push('/dashboard'), [router]);

  return (
    <div className="flex min-h-dvh-safe flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        {/* Slim the header on small screens (py-xs); restore py-sm at `sm:`. */}
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-md py-xs sm:py-sm">
          <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
          <Button variant="ghost" size="sm" onClick={exit} aria-label="계약 생성 나가기">
            나가기
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[760px] px-md pt-md sm:pt-lg">
        <StepIndicator steps={[...WIZARD_STEPS]} current={state.step} />
      </div>

      <main className="mx-auto w-full max-w-[760px] flex-1 px-md py-xl">
        {/* Re-keying by step replays the directional slide on every transition. */}
        <div
          key={state.step}
          className={state.direction === 1 ? 'animate-wizard-forward' : 'animate-wizard-back'}
        >
          <StepSlot step={state.step} />
        </div>
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-border bg-surface">
        {/* `.pb-safe-cta` clears the iOS home indicator (= inset + spacing.md);
            desktop insets resolve to 0, so pt-md/pb match the previous py-md. */}
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-md px-md pt-md pb-safe-cta">
          <Button
            variant="ghost"
            size="md"
            onClick={state.step === 0 ? exit : goBack}
          >
            {state.step === 0 ? '취소' : '이전'}
          </Button>

          {state.step < LAST_STEP ? (
            <Button size="md" onClick={goNext} disabled={!proceed} className="min-w-[120px]">
              다음
            </Button>
          ) : (
            // Review/send step (grain-9) renders its own 발송 CTA in its slot.
            <span aria-hidden="true" />
          )}
        </div>
      </footer>
    </div>
  );
}

/** Renders the active step's content. Only the upload slot is built in grain-6. */
function StepSlot({ step }: { step: number }) {
  switch (step) {
    case 0:
      return <UploadStep />;
    case 1:
      return <FieldsStep />;
    case 2:
      return <RecipientsStep />;
    case 3:
      return <ReviewStep />;
    default:
      return null;
  }
}
