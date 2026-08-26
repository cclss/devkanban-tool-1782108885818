import {
  UNKNOWN_WEB_TRANSLATION_FALLBACK,
  createWebTranslationRuntime,
  interpolate,
} from './web-translations';

describe('web translation fallback runtime', () => {
  it('uses Korean base copy and reports a missing English key without exposing the key', () => {
    const runtime = createWebTranslationRuntime({
      ko: { auth: { welcome: '환영합니다' } },
      en: { auth: {} },
    });

    expect(runtime.translate('en', 'auth.welcome')).toBe('환영합니다');
    expect(runtime.translate('en', 'auth.welcome')).toBe('환영합니다');
    expect(runtime.getFallbackReport()).toEqual({
      missingKeys: ['auth.welcome'],
      entries: [{
        key: 'auth.welcome',
        requestedLocale: 'en',
        fallbackLocale: 'ko',
        reason: 'missing',
        count: 2,
      }],
    });
  });

  it('treats empty English values as missing and never returns a key or blank value', () => {
    const runtime = createWebTranslationRuntime({
      ko: { auth: { welcome: '환영합니다' } },
      en: { auth: { welcome: '   ' } },
    });

    expect(runtime.translate('en', 'auth.welcome')).toBe('환영합니다');
    expect(runtime.translate('en', 'auth.unknown')).toBe(UNKNOWN_WEB_TRANSLATION_FALLBACK);
    expect(runtime.getFallbackReport().entries).toEqual([
      {
        key: 'auth.welcome',
        requestedLocale: 'en',
        fallbackLocale: 'ko',
        reason: 'empty',
        count: 1,
      },
      {
        key: 'auth.unknown',
        requestedLocale: 'en',
        fallbackLocale: 'ko',
        reason: 'missing',
        count: 1,
      },
    ]);
  });

  it('keeps the key list de-duplicated while retaining per-request-locale diagnostics', () => {
    const runtime = createWebTranslationRuntime({
      ko: { auth: {} },
      en: { auth: {} },
    });

    runtime.translate('en', 'auth.welcome');
    runtime.translate('en', 'auth.welcome');
    runtime.translate('ko', 'auth.welcome');

    expect(runtime.getFallbackReport()).toEqual({
      missingKeys: ['auth.welcome'],
      entries: [
        {
          key: 'auth.welcome',
          requestedLocale: 'en',
          fallbackLocale: 'ko',
          reason: 'missing',
          count: 2,
        },
        {
          key: 'auth.welcome',
          requestedLocale: 'ko',
          fallbackLocale: 'ko',
          reason: 'missing',
          count: 1,
        },
      ],
    });
  });
});

describe('interpolate', () => {
  it('substitutes a single placeholder with a string value', () => {
    expect(interpolate('{name}님이 전송함', { name: '김' })).toBe('김님이 전송함');
  });

  it('substitutes multiple placeholders independently', () => {
    expect(interpolate('{name} → {count}건', { name: '김', count: 3 })).toBe('김 → 3건');
  });

  it('stringifies numeric values', () => {
    expect(interpolate('{count}개 남음', { count: 0 })).toBe('0개 남음');
  });

  it('leaves an unmatched placeholder verbatim instead of blanking it', () => {
    expect(interpolate('{name}님 안녕하세요', {})).toBe('{name}님 안녕하세요');
    expect(interpolate('{a} {b}', { a: '하나' })).toBe('하나 {b}');
  });

  it('treats null and undefined values as unmatched', () => {
    expect(
      interpolate('{a}{b}', { a: undefined as unknown as string, b: null as unknown as string }),
    ).toBe('{a}{b}');
  });

  it('returns the template unchanged when no vars are given', () => {
    expect(interpolate('{name}님이 전송함')).toBe('{name}님이 전송함');
  });

  it('unescapes doubled braces to literal braces', () => {
    expect(interpolate('{{name}}', { name: '김' })).toBe('{name}');
    expect(interpolate('가격 {{ {price}원', { price: 100 })).toBe('가격 { 100원');
  });

  it('does not re-interpolate braces contained in a substituted value', () => {
    expect(interpolate('{greeting}', { greeting: '{name}님', name: '무시됨' })).toBe('{name}님');
  });
});

describe('runtime interpolation', () => {
  it('fills placeholders in localized copy', () => {
    const runtime = createWebTranslationRuntime({
      ko: { share: { sentBy: '{name}님이 전송함' } },
      en: { share: { sentBy: 'Sent by {name}' } },
    });

    expect(runtime.translate('ko', 'share.sentBy', { name: '김' })).toBe('김님이 전송함');
    expect(runtime.translate('en', 'share.sentBy', { name: 'Kim' })).toBe('Sent by Kim');
  });

  it('fills placeholders after falling back to Korean copy', () => {
    const runtime = createWebTranslationRuntime({
      ko: { share: { sentBy: '{name}님이 전송함' } },
      en: { share: {} },
    });

    expect(runtime.translate('en', 'share.sentBy', { name: '김' })).toBe('김님이 전송함');
    expect(runtime.getFallbackReport().missingKeys).toEqual(['share.sentBy']);
  });

  it('returns a safe string when the key is unknown even with vars', () => {
    const runtime = createWebTranslationRuntime({ ko: {}, en: {} });

    expect(runtime.translate('ko', 'x.y', { name: '김' })).toBe(UNKNOWN_WEB_TRANSLATION_FALLBACK);
  });
});
