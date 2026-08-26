import {
  localeFromBrowserLanguages,
  parseLocale,
  resolveLocale,
} from './locale';

describe('web locale resolver', () => {
  it('normalises supported language tags', () => {
    expect(parseLocale('en-US')).toBe('en');
    expect(parseLocale('ko_KR')).toBe('ko');
    expect(parseLocale('fr-FR')).toBeUndefined();
  });

  it('uses a logged-in user preference before sender and browser values', () => {
    expect(
      resolveLocale({ userLocale: 'en', senderLocale: 'ko', browserLanguages: ['ko-KR'] }),
    ).toBe('en');
  });

  it('uses the sender locale for public links before browser preferences', () => {
    expect(resolveLocale({ senderLocale: 'en', browserLanguages: ['ko-KR'] })).toBe('en');
  });

  it('uses the first supported browser language and safely defaults to Korean', () => {
    expect(localeFromBrowserLanguages(['fr-FR', 'en-GB', 'ko-KR'])).toBe('en');
    expect(resolveLocale({ browserLanguages: ['fr-FR', 'ja-JP'] })).toBe('ko');
  });
});
