import {
  UNKNOWN_WEB_TRANSLATION_FALLBACK,
  createWebTranslationRuntime,
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
