import { hasCopyParity, copyKeyDiff } from './copy-locale';
import {
  TEMPLATES_COPY_CATALOGS,
  templatesCopyFor,
  templateActionsCopyFor,
  templateFieldPreviewCopyFor,
  templateMetaCopyFor,
} from './templates-copy';

/**
 * The ko/en key-parity gate for the templates copy surface. A locale is "fully
 * translated" for this surface when its English catalog has the exact same key
 * structure as the Korean base — a missing English key would otherwise silently
 * fall back to Korean (the very bug this locale refactor exists to close).
 */
describe('templates-copy locale parity', () => {
  describe('ko/en key parity for every catalog surface', () => {
    for (const [name, { ko, en }] of Object.entries(TEMPLATES_COPY_CATALOGS)) {
      it(`${name} has identical ko/en keys`, () => {
        // Surfacing the diff makes a failure name the exact missing/extra path.
        expect(copyKeyDiff(ko, en)).toEqual([]);
        expect(hasCopyParity(ko, en)).toBe(true);
      });
    }
  });

  describe('templatesCopyFor', () => {
    it('localizes the list heading (ko and en differ)', () => {
      expect(templatesCopyFor('ko').title).not.toBe(templatesCopyFor('en').title);
      expect(templatesCopyFor('en').emptyCta).toBeTruthy();
    });
  });

  describe('templateActionsCopyFor', () => {
    it('localizes the function-built labels with the interpolated name in both locales', () => {
      const ko = templateActionsCopyFor('ko');
      const en = templateActionsCopyFor('en');
      expect(ko.actionsLabel('NDA')).toContain('NDA');
      expect(en.actionsLabel('NDA')).toContain('NDA');
      expect(ko.actionsLabel('NDA')).not.toBe(en.actionsLabel('NDA'));

      expect(ko.delete_dialog.title('NDA')).toContain('NDA');
      expect(en.delete_dialog.title('NDA')).toContain('NDA');
      expect(ko.delete_dialog.title('NDA')).not.toBe(en.delete_dialog.title('NDA'));

      expect(ko.preview_dialog.title('NDA')).toContain('NDA');
      expect(en.preview_dialog.title('NDA')).toContain('NDA');
    });
  });

  describe('templateFieldPreviewCopyFor', () => {
    it('localizes the page label but keeps the numeric page indicator', () => {
      const ko = templateFieldPreviewCopyFor('ko');
      const en = templateFieldPreviewCopyFor('en');
      expect(ko.pageLabel(2, 5)).not.toBe(en.pageLabel(2, 5));
      // The indicator is pure numerals — identical across locales.
      expect(ko.pageIndicator(2, 5)).toBe(en.pageIndicator(2, 5));
      expect(en.recipientBadgeLabel(1)).toContain('1');
    });
  });

  describe('templateMetaCopyFor', () => {
    it('localizes the meta units, carrying the count through in both locales', () => {
      const ko = templateMetaCopyFor('ko');
      const en = templateMetaCopyFor('en');
      expect(ko.pages(3)).toContain('3');
      expect(en.pages(3)).toContain('3');
      expect(ko.pages(3)).not.toBe(en.pages(3));
      expect(ko.fields(2)).not.toBe(en.fields(2));
      expect(ko.savedSuffix).not.toBe(en.savedSuffix);
    });
  });
});
