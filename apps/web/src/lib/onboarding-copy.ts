/**
 * Onboarding guide copy — the single source of truth for the user-facing strings
 * of the first-run welcome guide (the "make your first contract" walkthrough that
 * new users see on the dashboard).
 *
 * Source of truth for tone: design-spec/messaging/recording.md (project base
 * voice) — 해요체, no blame, always give the next action, and stay calm (never
 * manufacture urgency). Per base voice principle 6, every user-facing string lives
 * in one place (`lib/*-copy.ts`), mirroring `lib/todo-copy.ts`; the OnboardingGuide
 * component takes these as props and never owns the wording itself.
 *
 * The design of the guide (step structure, tone, tokens, CTA rule) is recorded in
 * design-spec/components/onboarding-guide/base.md.
 */

/** One numbered step in the first-contract walkthrough. */
export interface OnboardingStep {
  /** Short verb-phrase heading, e.g. "계약서 올리기". */
  title: string;
  /** One calm 해요체 sentence describing the step. */
  description: string;
}

/** The full copy payload the OnboardingGuide renders (all strings injected). */
export interface OnboardingCopy {
  /** Guide heading. */
  title: string;
  /** One-line lead under the heading. */
  description: string;
  /** The ordered steps (①업로드 ②서명 요청 ③완료 추적). */
  steps: OnboardingStep[];
  /** Primary CTA label that triggers `onCreate` (start the first real contract). */
  cta: string;
}

/**
 * Default onboarding copy. The three steps mirror the real product flow a new
 * user is about to take — upload → request signature → track completion — kept to
 * one calm sentence each. Base voice: invite the next action ("만들어 보세요"),
 * never pressure.
 */
export const ONBOARDING_COPY: OnboardingCopy = {
  title: '3단계로 첫 계약을 보내요',
  description: '이렇게 계약서를 보내고 서명을 받을 수 있어요. 준비되면 첫 계약을 만들어 보세요.',
  steps: [
    {
      title: '계약서 올리기',
      description: '서명받을 PDF 계약서를 업로드해요.',
    },
    {
      title: '서명 요청 보내기',
      description: '받는 분에게 서명 위치를 지정하고 발송해요.',
    },
    {
      title: '완료까지 추적하기',
      description: '서명 요청부터 완료까지 대시보드에서 한눈에 확인해요.',
    },
  ],
  cta: '첫 계약 만들기',
};
