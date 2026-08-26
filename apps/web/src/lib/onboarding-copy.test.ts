import { onboardingCopy } from './onboarding-copy';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
} from './web-translations';

/** Flatten every user-facing string in an OnboardingCopy payload. */
function allStrings(copy: ReturnType<typeof onboardingCopy>): string[] {
  return [
    copy.title,
    copy.description,
    copy.cta,
    ...copy.steps.flatMap((step) => [step.title, step.description]),
  ];
}

describe('onboardingCopy', () => {
  it('assembles the guide payload with the three product-flow steps', () => {
    const copy = onboardingCopy('ko');
    expect(copy.steps).toHaveLength(3);
    expect(copy.title).toBe('3단계로 첫 계약을 보내요');
    expect(copy.steps[0]?.title).toBe('계약서 올리기');
    expect(copy.cta).toBe('첫 계약 만들기');
  });

  it('switches the whole payload KO→EN', () => {
    const ko = onboardingCopy('ko');
    const en = onboardingCopy('en');
    expect(en.title).toBe('Send your first contract in 3 steps');
    expect(en.cta).toBe('Create your first contract');
    expect(en.steps[0]?.title).toBe('Upload the contract');
    // Every localized string actually differs between the two locales.
    allStrings(ko).forEach((value, index) => {
      expect(value).not.toBe(allStrings(en)[index]);
    });
  });

  it('emits no empty string in either locale', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const s of allStrings(onboardingCopy(locale))) {
        expect(s.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every emitted key with a zero missing-key report in English', () => {
    resetWebTranslationFallbackReport();
    onboardingCopy('en');
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });
});
