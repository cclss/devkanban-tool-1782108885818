/**
 * The app-wide untranslated-key gate (grain-6).
 *
 * This is the failing-on-drift test the coverage gate is built on. It proves:
 *   1. Every registered bilingual surface (WEB_TRANSLATIONS + every `*-copy`
 *      module + signing) is currently in full ko/en key parity.
 *   2. The offline `WEB_TRANSLATIONS` audit sees zero fallbacks when fully
 *      translated, and surfaces the exact key when one is removed/emptied.
 *   3. Injecting a missing English key makes `assertTranslationParity` fail and
 *      name the offending surface + key path — so a real drift breaks CI.
 */

import {
  assertTranslationParity,
  collectParityViolations,
  TranslationParityError,
  type CopyParityTarget,
} from './copy-locale';
import { collectCopyParityTargets } from './translation-parity';
import {
  auditWebTranslationCatalogs,
  getWebTranslationCoverageAudit,
} from './web-translations';

describe('app-wide translation parity gate', () => {
  it('registers WEB_TRANSLATIONS and every per-surface copy module', () => {
    const labels = collectCopyParityTargets().map((target) => target.label);
    expect(labels).toContain('web-translations');
    // A representative from each family, incl. the signing surface this grain added.
    expect(labels).toEqual(
      expect.arrayContaining([
        'web-translations',
        'contract-detail.detail',
        'settings.branding',
        'sharing.share',
        'signing.signer',
        'todo.summary',
      ]),
    );
  });

  it('passes: all shipped surfaces have full ko/en key parity', () => {
    expect(() => assertTranslationParity(collectCopyParityTargets())).not.toThrow();
    expect(collectParityViolations(collectCopyParityTargets())).toEqual([]);
  });

  it('offline audit reports no fallbacks when WEB_TRANSLATIONS is fully translated', () => {
    expect(getWebTranslationCoverageAudit()).toEqual({ missingKeys: [], entries: [] });
  });
});

describe('gate fails when a translation is missing', () => {
  it('throws a TranslationParityError naming the surface and key when en drops a key', () => {
    // Clone a real target and delete one English key to simulate drift.
    const targets = collectCopyParityTargets();
    const broken: CopyParityTarget[] = targets.map((target) =>
      target.label === 'sharing.share'
        ? { ...target, en: stripKey(target.en, ['header', 'title']) }
        : target,
    );

    let error: unknown;
    try {
      assertTranslationParity(broken);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TranslationParityError);
    const parityError = error as TranslationParityError;
    expect(parityError.violations).toHaveLength(1);
    const [violation] = parityError.violations;
    expect(violation?.label).toBe('sharing.share');
    expect(violation?.mismatches).toContainEqual({
      path: 'header.title',
      reason: 'missing',
    });
    expect(parityError.message).toContain('sharing.share');
    expect(parityError.message).toContain('header.title');
  });

  it('offline audit surfaces a missing English key', () => {
    const report = auditWebTranslationCatalogs({
      ko: { auth: { login: '로그인', signup: '회원가입' } },
      en: { auth: { login: 'Sign in' } },
    });
    expect(report.missingKeys).toEqual(['auth.signup']);
    expect(report.entries).toEqual([
      {
        key: 'auth.signup',
        requestedLocale: 'en',
        fallbackLocale: 'ko',
        reason: 'missing',
        count: 1,
      },
    ]);
  });

  it('offline audit treats a blank English value as a fallback', () => {
    const report = auditWebTranslationCatalogs({
      ko: { auth: { login: '로그인' } },
      en: { auth: { login: '   ' } },
    });
    expect(report.entries).toEqual([
      {
        key: 'auth.login',
        requestedLocale: 'en',
        fallbackLocale: 'ko',
        reason: 'empty',
        count: 1,
      },
    ]);
  });

  it('offline audit ignores keys the Korean base itself does not provide', () => {
    const report = auditWebTranslationCatalogs({
      ko: { auth: { login: '로그인' } },
      // English has an extra key; it can never render a fallback, so it is not a gap.
      en: { auth: { login: 'Sign in', extra: 'Extra' } },
    });
    expect(report).toEqual({ missingKeys: [], entries: [] });
  });
});

/** Return a shallow clone of `catalog` with the nested `path` key removed. */
function stripKey(catalog: unknown, path: readonly string[]): unknown {
  if (typeof catalog !== 'object' || catalog === null) return catalog;
  const [head, ...rest] = path;
  if (head === undefined) return catalog;
  const clone: Record<string, unknown> = { ...(catalog as Record<string, unknown>) };
  if (rest.length === 0) {
    delete clone[head];
  } else {
    clone[head] = stripKey(clone[head], rest);
  }
  return clone;
}
