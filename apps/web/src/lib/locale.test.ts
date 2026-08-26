import {
  localeFromBrowserLanguages,
  parseAcceptLanguage,
  parseLocale,
  resolveLocale,
  resolveServerLocale,
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

describe('server-side locale resolution', () => {
  it('orders Accept-Language tags by q-value and drops q=0/malformed weights', () => {
    expect(parseAcceptLanguage('ko-KR,en-US;q=0.8,fr;q=0.9')).toEqual([
      'ko-KR',
      'fr',
      'en-US',
    ]);
    expect(parseAcceptLanguage('en;q=0, ko;q=bad, fr')).toEqual(['fr']);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });

  it('prefers the saved-locale cookie over the browser header', () => {
    expect(
      resolveServerLocale({ cookieLocale: 'en', acceptLanguage: 'ko-KR,ko;q=0.9' }),
    ).toBe('en');
  });

  it('falls back to Accept-Language, then Korean, when no cookie is stored', () => {
    expect(resolveServerLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
    expect(resolveServerLocale({ acceptLanguage: 'fr-FR' })).toBe('ko');
    expect(resolveServerLocale({})).toBe('ko');
  });
});
