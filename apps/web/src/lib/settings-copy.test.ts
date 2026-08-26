import { SETTINGS_DEFAULT_ROUTE, SETTINGS_NAV_ITEMS } from './settings-copy';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
  translateWeb,
} from './web-translations';

describe('settings navigation structure', () => {
  it('lists only sections with a real page, in menu order', () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.href)).toEqual([
      '/settings/branding',
      '/settings/language',
    ]);
  });

  it('lands on a route that exists in the nav', () => {
    expect(SETTINGS_NAV_ITEMS.some((item) => item.href === SETTINGS_DEFAULT_ROUTE)).toBe(true);
  });
});

describe('settings nav label localization', () => {
  it('resolves each nav label key and switches KO→EN', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      const ko = translateWeb('ko', item.labelKey);
      const en = translateWeb('en', item.labelKey);
      expect(ko.trim().length).toBeGreaterThan(0);
      expect(en.trim().length).toBeGreaterThan(0);
      expect(ko).not.toBe(en);
    }
  });

  it('localizes representative labels per locale', () => {
    expect(translateWeb('ko', 'settings.branding')).toBe('브랜딩');
    expect(translateWeb('en', 'settings.branding')).toBe('Branding');
    expect(translateWeb('ko', 'settings.language')).toBe('언어');
    expect(translateWeb('en', 'settings.language')).toBe('Language');
  });

  it('resolves every nav label key with a zero missing-key report in English', () => {
    resetWebTranslationFallbackReport();
    for (const item of SETTINGS_NAV_ITEMS) {
      translateWeb('en', item.labelKey);
    }
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });
});
