/**
 * Onboarding guide copy — the locale-aware selector for the user-facing strings
 * of the first-run welcome guide (the "make your first contract" walkthrough that
 * new users see on the dashboard).
 *
 * The strings live in the `onboarding` namespace of the web translation catalog
 * (`web-translations.ts`); this module assembles them into the `OnboardingCopy`
 * shape the guide renders. The OnboardingGuide component still takes copy as props
 * and never owns wording; the dashboard builds the payload from the active locale.
 *
 * The design of the guide (step structure, tone, tokens, CTA rule) is recorded in
 * design-spec/components/onboarding-guide/base.md.
 */

import type { SupportedLocale } from './locale';
import { translateWeb } from './web-translations';

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
 * Onboarding copy for a locale. The three steps mirror the real product flow a
 * new user is about to take — upload → request signature → track completion —
 * kept to one calm sentence each. Base voice: invite the next action, never
 * pressure.
 */
export function onboardingCopy(locale: SupportedLocale): OnboardingCopy {
  return {
    title: translateWeb(locale, 'onboarding.title'),
    description: translateWeb(locale, 'onboarding.description'),
    steps: [
      {
        title: translateWeb(locale, 'onboarding.step1Title'),
        description: translateWeb(locale, 'onboarding.step1Description'),
      },
      {
        title: translateWeb(locale, 'onboarding.step2Title'),
        description: translateWeb(locale, 'onboarding.step2Description'),
      },
      {
        title: translateWeb(locale, 'onboarding.step3Title'),
        description: translateWeb(locale, 'onboarding.step3Description'),
      },
    ],
    cta: translateWeb(locale, 'onboarding.cta'),
  };
}
