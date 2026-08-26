import { copyKeyDiff, hasCopyParity } from './copy-locale';
import { ONBOARDING_COPY_CATALOGS, onboardingCopyFor } from './onboarding-copy';

/**
 * The ko/en key-parity gate for the first-run onboarding guide copy. `copyKeyDiff`
 * treats the `steps` array as an opaque leaf, so beyond top-level key parity this
 * suite also asserts step-count parity and non-empty per-step wording in both
 * locales — the walkthrough must stay the same three-step flow, fully translated.
 */
describe('onboarding-copy locale parity', () => {
  describe('ko/en key parity for every catalog surface', () => {
    for (const [name, { ko, en }] of Object.entries(ONBOARDING_COPY_CATALOGS)) {
      it(`${name} has identical ko/en top-level keys`, () => {
        expect(copyKeyDiff(ko, en)).toEqual([]);
        expect(hasCopyParity(ko, en)).toBe(true);
      });
    }
  });

  describe('onboardingCopyFor', () => {
    it('returns the Korean base for ko and a distinct English catalog for en', () => {
      const ko = onboardingCopyFor('ko');
      const en = onboardingCopyFor('en');
      expect(ko.title).toBe('3단계로 첫 계약을 보내요');
      expect(en.title).toBe('Send your first contract in 3 steps');
      expect(ko.title).not.toBe(en.title);
      expect(ko.cta).not.toBe(en.cta);
    });

    it('keeps the same number of steps across locales', () => {
      const ko = onboardingCopyFor('ko');
      const en = onboardingCopyFor('en');
      expect(en.steps.length).toBe(ko.steps.length);
      expect(ko.steps.length).toBe(3);
    });

    it('gives every step a non-empty, localized title and description', () => {
      const ko = onboardingCopyFor('ko');
      const en = onboardingCopyFor('en');
      ko.steps.forEach((koStep, i) => {
        const enStep = en.steps[i]!;
        expect(koStep.title).not.toBe('');
        expect(koStep.description).not.toBe('');
        expect(enStep.title).not.toBe('');
        expect(enStep.description).not.toBe('');
        // Each step is actually translated, not a Korean fallback.
        expect(enStep.title).not.toBe(koStep.title);
        expect(enStep.description).not.toBe(koStep.description);
      });
    });
  });
});
