import { hasCopyParity, copyKeyDiff } from './copy-locale';
import {
  SETTINGS_COPY_CATALOGS,
  headerBrandCopyFor,
  settingsShellCopyFor,
  settingsNavItemsFor,
} from './settings-copy';

/**
 * The ko/en key-parity gate for the settings copy surface. A locale is "fully
 * translated" for this surface when its English catalog has the exact same key
 * structure as the Korean base — a missing English key would otherwise silently
 * fall back to Korean (the very bug this locale refactor exists to close).
 */
describe('settings-copy locale parity', () => {
  describe('ko/en key parity for every catalog surface', () => {
    for (const [name, { ko, en }] of Object.entries(SETTINGS_COPY_CATALOGS)) {
      it(`${name} has identical ko/en keys`, () => {
        // Surfacing the diff makes a failure name the exact missing/extra path.
        expect(copyKeyDiff(ko, en)).toEqual([]);
        expect(hasCopyParity(ko, en)).toBe(true);
      });
    }
  });

  describe('headerBrandCopyFor', () => {
    it('resolves a non-empty wordmark + logo alt in both locales', () => {
      for (const locale of ['ko', 'en'] as const) {
        const copy = headerBrandCopyFor(locale);
        expect(copy.wordmark).toBeTruthy();
        expect(copy.logoAlt).toBeTruthy();
      }
    });

    it('localizes the wordmark (ko and en differ)', () => {
      expect(headerBrandCopyFor('ko').wordmark).not.toBe(headerBrandCopyFor('en').wordmark);
    });
  });

  describe('settingsShellCopyFor', () => {
    it('localizes the section title (ko and en differ)', () => {
      expect(settingsShellCopyFor('ko').sectionTitle).not.toBe(
        settingsShellCopyFor('en').sectionTitle,
      );
    });
  });

  describe('settingsNavItemsFor', () => {
    it('keeps locale-invariant routes but localizes labels', () => {
      const ko = settingsNavItemsFor('ko');
      const en = settingsNavItemsFor('en');
      // Same routes, same order, in every locale — only the label is translated.
      expect(en.map((i) => i.href)).toEqual(ko.map((i) => i.href));
      expect(en.length).toBe(ko.length);
      ko.forEach((koItem, i) => {
        const enItem = en[i];
        expect(enItem).toBeDefined();
        expect(koItem.label).toBeTruthy();
        expect(enItem?.label).toBeTruthy();
        expect(koItem.label).not.toBe(enItem?.label);
      });
    });
  });
});
