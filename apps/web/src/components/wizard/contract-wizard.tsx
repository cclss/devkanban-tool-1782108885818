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
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-md py-sm">
          <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
          <Button variant="ghost" size="sm" onClick={exit} aria-label="계약 생성 나가기">
            나가기
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[760px] px-md pt-lg">
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
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-md px-md py-md">
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
      return <PlaceholderStep title="받는 분을 입력해요" />;
    case 3:
      return <PlaceholderStep title="발송 전 확인해요" />;
    default:
      return null;
  }
}

/**
 * Empty slot for steps a later grain fills. Intentionally minimal — grain-7/8/9
 * replace this with the real step content.
 */
function PlaceholderStep({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-xs rounded-lg border border-dashed border-border-strong bg-surface-muted px-md py-3xl text-center">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      <p className="text-sm text-foreground-subtle">이 단계는 곧 이어집니다.</p>
    </div>
  );
}
