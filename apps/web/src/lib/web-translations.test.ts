import {
  UNKNOWN_WEB_TRANSLATION_FALLBACK,
  WEB_TRANSLATIONS,
  createWebTranslationRuntime,
  getWebTranslationFallbackReport,
  interpolate,
  resetWebTranslationFallbackReport,
  translateWeb,
  type WebTranslationKey,
} from './web-translations';
import { resolveServerLocale } from './locale';

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

describe('dev-mode fallback warning', () => {
  const env = process.env as Record<string, string | undefined>;
  const withNodeEnv = (value: string | undefined, run: () => void) => {
    const previous = env.NODE_ENV;
    if (value === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = value;
    try {
      run();
    } finally {
      if (previous === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previous;
    }
  };

  it('warns once per unique key on first fallback, not on repeats', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withNodeEnv('development', () => {
        const runtime = createWebTranslationRuntime({
          ko: { auth: { welcome: '환영합니다', bye: '안녕히 가세요' } },
          en: { auth: {} },
        });

        runtime.translate('en', 'auth.welcome');
        runtime.translate('en', 'auth.welcome');
        runtime.translate('ko', 'auth.welcome');
        runtime.translate('en', 'auth.bye');

        expect(warn).toHaveBeenCalledTimes(2);
        const messages = warn.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes('auth.welcome') && m.includes('en') && m.includes('missing'))).toBe(true);
        expect(messages.some((m) => m.includes('auth.bye'))).toBe(true);
        // Never leaks the rendered fallback copy or interpolation vars.
        for (const message of messages) {
          expect(message).not.toContain('환영합니다');
          expect(message).not.toContain('안녕히 가세요');
        }
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('stays silent in production', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      withNodeEnv('production', () => {
        const runtime = createWebTranslationRuntime({
          ko: { auth: { welcome: '환영합니다' } },
          en: { auth: {} },
        });

        expect(runtime.translate('en', 'auth.welcome')).toBe('환영합니다');
        expect(warn).not.toHaveBeenCalled();
        // The structured report still records the fallback in production.
        expect(runtime.getFallbackReport().missingKeys).toEqual(['auth.welcome']);
      });
    } finally {
      warn.mockRestore();
    }
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

describe('interpolation contract (regression)', () => {
  it('fills multiple variables independently in a single pass', () => {
    expect(
      interpolate('{name}님이 {count}건을 전송함', { name: '김', count: 3 }),
    ).toBe('김님이 3건을 전송함');
    // Order-independent and each token draws only from its own var.
    expect(interpolate('{b}-{a}-{b}', { a: '1', b: '2' })).toBe('2-1-2');
  });

  it('leaves a missing, null, or undefined variable verbatim as {token}', () => {
    expect(interpolate('{name}님이 전송함', {})).toBe('{name}님이 전송함');
    expect(
      interpolate('{present} {absent}', {
        present: '있음',
        absent: null as unknown as string,
      }),
    ).toBe('있음 {absent}');
    expect(
      interpolate('{present} {absent}', {
        present: '있음',
        absent: undefined as unknown as string,
      }),
    ).toBe('있음 {absent}');
  });

  it('leaves a non-identifier token literal even when a var could match it', () => {
    // Hyphen is outside \w, so the whole brace run is not a recognized token.
    expect(interpolate('{full-name}님', { 'full-name': '김하나' })).toBe('{full-name}님');
    // Non-ASCII token names are likewise never recognized.
    expect(interpolate('{이름}님', { 이름: '김' })).toBe('{이름}님');
    // A spaced or empty brace run stays literal too.
    expect(interpolate('{ name }', { name: '김' })).toBe('{ name }');
    expect(interpolate('{}', { '': '김' })).toBe('{}');
  });

  it('applies the same rules through the catalog lookup on both localized and ko-fallback paths', () => {
    const runtime = createWebTranslationRuntime({
      ko: { share: { sentBy: '{name}님이 {count}건 전송함' } },
      en: { share: {} },
    });

    // Localized (en) path is absent → ko-fallback path fills multiple vars.
    expect(runtime.translate('en', 'share.sentBy', { name: '김', count: 2 })).toBe(
      '김님이 2건 전송함',
    );
    // Missing var stays verbatim through the localized (ko) path.
    expect(runtime.translate('ko', 'share.sentBy', { name: '김' })).toBe(
      '김님이 {count}건 전송함',
    );
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

describe('catalog parity', () => {
  const flatKeys = (catalog: (typeof WEB_TRANSLATIONS)['ko' | 'en']): string[] => {
    const keys: string[] = [];
    for (const [namespace, group] of Object.entries(catalog)) {
      for (const key of Object.keys(group as Record<string, unknown>)) {
        keys.push(`${namespace}.${key}`);
      }
    }
    return keys.sort();
  };

  it('exposes the identical set of keys in ko and en (no locale-only key)', () => {
    expect(flatKeys(WEB_TRANSLATIONS.en)).toEqual(flatKeys(WEB_TRANSLATIONS.ko));
  });

  it('has no empty value in either locale', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const group of Object.values(WEB_TRANSLATIONS[locale])) {
        for (const [key, value] of Object.entries(group as Record<string, string>)) {
          expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
          void key;
        }
      }
    }
  });

  it('resolves every cataloged key in English with a zero missing-key report', () => {
    resetWebTranslationFallbackReport();
    for (const namespace of Object.keys(WEB_TRANSLATIONS.en)) {
      const group = WEB_TRANSLATIONS.en[namespace as keyof typeof WEB_TRANSLATIONS.en];
      for (const key of Object.keys(group)) {
        const resolved = translateWeb('en', `${namespace}.${key}` as WebTranslationKey);
        expect(resolved.length).toBeGreaterThan(0);
      }
    }
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });
});

describe('share and common namespaces', () => {
  it('exposes the share and common namespaces in both locales', () => {
    for (const locale of ['ko', 'en'] as const) {
      expect(Object.keys(WEB_TRANSLATIONS[locale])).toEqual(
        expect.arrayContaining(['share', 'common']),
      );
    }
  });

  it('localizes representative share copy per locale', () => {
    expect(translateWeb('ko', 'share.gateTitle')).toBe('비밀번호를 입력해 주세요');
    expect(translateWeb('en', 'share.gateTitle')).toBe('Enter the password');
    expect(translateWeb('en', 'share.doneTitle')).toBe('Submission complete!');
  });

  it('interpolates share placeholders in both locales', () => {
    expect(translateWeb('ko', 'share.gateTooShort', { min: 4 })).toBe(
      '비밀번호는 4자 이상으로 입력해 주세요.',
    );
    expect(translateWeb('en', 'share.gateTooShort', { min: 4 })).toBe(
      'Enter at least 4 characters.',
    );
    expect(translateWeb('en', 'share.viewerProgress', { total: 3, done: 1 })).toBe(
      'Completed 1 of 3 fields.',
    );
    expect(translateWeb('en', 'share.viewerPageError', { page: 2 })).toBe(
      'We could not load page 2.',
    );
  });

  it('localizes cross-cutting common copy per locale', () => {
    expect(translateWeb('ko', 'common.cancel')).toBe('취소');
    expect(translateWeb('en', 'common.cancel')).toBe('Cancel');
    expect(translateWeb('en', 'common.retry')).toBe('Try again');
  });
});

describe('header language switch catalog', () => {
  it('exposes the header language-switch keys in both locales', () => {
    for (const locale of ['ko', 'en'] as const) {
      expect(Object.keys(WEB_TRANSLATIONS[locale].header)).toEqual(
        expect.arrayContaining(['languageSwitchLabel', 'localeKo', 'localeEn']),
      );
    }
  });

  it('localizes the radiogroup label per locale and shows each language endonym', () => {
    expect(translateWeb('ko', 'header.languageSwitchLabel')).toBe('언어 선택');
    expect(translateWeb('en', 'header.languageSwitchLabel')).toBe('Select language');
    // Segment labels are endonyms — identical in either UI locale.
    for (const locale of ['ko', 'en'] as const) {
      expect(translateWeb(locale, 'header.localeKo')).toBe('한국어');
      expect(translateWeb(locale, 'header.localeEn')).toBe('English');
    }
  });

  it('resolves every header key with no missing-key fallback in English', () => {
    resetWebTranslationFallbackReport();
    for (const key of ['languageSwitchLabel', 'localeKo', 'localeEn'] as const) {
      const resolved = translateWeb('en', `header.${key}` as WebTranslationKey);
      expect(resolved.trim().length).toBeGreaterThan(0);
    }
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });
});

describe('document metadata catalog', () => {
  it('localizes the document title and description per locale', () => {
    expect(translateWeb('ko', 'meta.title')).toBe('전자계약');
    expect(translateWeb('ko', 'meta.description')).toBe('전자계약 SaaS');
    expect(translateWeb('en', 'meta.title')).toBe('eSign');
    expect(translateWeb('en', 'meta.description')).toBe('Electronic contract SaaS');
  });

  it('exposes the identical meta keys in ko and en (metadata parity)', () => {
    expect(Object.keys(WEB_TRANSLATIONS.en.meta).sort()).toEqual(
      Object.keys(WEB_TRANSLATIONS.ko.meta).sort(),
    );
    // The document metadata the root layout seeds must exist in both catalogs.
    expect(Object.keys(WEB_TRANSLATIONS.ko.meta).sort()).toEqual(['description', 'title']);
  });

  it('has non-empty meta title and description in every supported locale', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const key of ['title', 'description'] as const) {
        const value = translateWeb(locale, `meta.${key}`);
        expect(value.trim().length).toBeGreaterThan(0);
        // A seeded fallback placeholder or raw key must never reach <head>.
        expect(value).not.toBe(UNKNOWN_WEB_TRANSLATION_FALLBACK);
        expect(value).not.toContain('meta.');
      }
    }
  });

  it('seeds the same localized metadata that generateMetadata composes per request', () => {
    // Mirrors the root layout: resolveServerLocale picks the request locale and
    // translateWeb('meta.*') fills <html lang> title/description from the catalog.
    const seed = (input: { cookieLocale?: string | null; acceptLanguage?: string | null }) => {
      const locale = resolveServerLocale(input);
      return {
        locale,
        title: translateWeb(locale, 'meta.title'),
        description: translateWeb(locale, 'meta.description'),
      };
    };

    // Saved-locale cookie wins over the browser header.
    expect(seed({ cookieLocale: 'en', acceptLanguage: 'ko-KR,ko;q=0.9' })).toEqual({
      locale: 'en',
      title: 'eSign',
      description: 'Electronic contract SaaS',
    });
    // No cookie → Accept-Language decides.
    expect(seed({ acceptLanguage: 'en-US,en;q=0.9' })).toEqual({
      locale: 'en',
      title: 'eSign',
      description: 'Electronic contract SaaS',
    });
    // A Korean preference still seeds the Korean catalog (no regression).
    expect(seed({ acceptLanguage: 'ko-KR,ko;q=0.9' })).toEqual({
      locale: 'ko',
      title: '전자계약',
      description: '전자계약 SaaS',
    });
    // No usable signal → English default.
    expect(seed({})).toEqual({
      locale: 'en',
      title: 'eSign',
      description: 'Electronic contract SaaS',
    });
  });
});
