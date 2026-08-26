/**
 * Localization done-gate for the shared component layer routed through the web
 * translation catalog in this grain: the contract/template card relative-time and
 * meta builders (`time.*`, `contract.*`, `templates.metaPages`/`metaFields`/
 * `savedSuffix`), the dashboard header sign-out (`header.logout`), the password
 * reveal aria-labels (`auth.passwordShow`/`passwordHide`), and the auth divider
 * (`auth.dividerOr`).
 *
 * The per-key catalog and the `formatRelativeTime` helper are exercised together
 * under `locale='en'` and two invariants are locked:
 *
 *   1. The missing-key report is empty — every shared-layer key resolves to real
 *      English copy, never a Korean fallback.
 *   2. No emitted string contains Hangul — the shared layer shows zero Korean once
 *      English is the active locale (there is no endonym whitelist here: none of
 *      these keys is a language label).
 */

import { formatRelativeTime, type Translate } from './relative-time';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
  translateWeb,
} from './web-translations';
import type { SupportedLocale } from './locale';

/** Any precomposed Hangul syllable — the marker for un-migrated Korean copy. */
const HANGUL = /[가-힣]/;

/** Bind the catalog to one locale, matching how `useTranslation()` hands cards a translator. */
function translatorFor(locale: SupportedLocale): Translate {
  return (key, vars) => translateWeb(locale, key, vars);
}

/** Every relative-time branch the cards can render, plus the meta/label keys they emit. */
function emitSharedLayer(locale: SupportedLocale): string[] {
  const t = translatorFor(locale);
  const now = Date.now();
  const MIN = 60_000;
  const justNow = formatRelativeTime(new Date(now - 10_000).toISOString(), t);
  const relative = [
    justNow, // just now
    formatRelativeTime(new Date(now - 5 * MIN).toISOString(), t), // minutes
    formatRelativeTime(new Date(now - 3 * 60 * MIN).toISOString(), t), // hours
    formatRelativeTime(new Date(now - 3 * 24 * 60 * MIN).toISOString(), t), // days
    formatRelativeTime(new Date(now - 30 * 24 * 60 * MIN).toISOString(), t), // absolute date
  ];
  return [
    ...relative,
    // contract-card meta builders
    t('contract.metaRecipients', { n: 3 }),
    t('contract.metaPages', { n: 5 }),
    t('contract.metaSent', { when: justNow }),
    t('contract.metaCreated', { when: justNow }),
    // template-card meta builders
    t('templates.metaPages', { n: 5 }),
    t('templates.metaFields', { n: 4 }),
    t('templates.savedSuffix'),
    // dashboard-header, password-input, auth-divider
    t('header.logout'),
    t('auth.passwordShow'),
    t('auth.passwordHide'),
    t('auth.dividerOr'),
  ];
}

describe('shared-layer localization done-gate (EN)', () => {
  it('resolves every shared-layer key under EN with a zero missing-key report', () => {
    resetWebTranslationFallbackReport();
    emitSharedLayer('en');
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });

  it('emits zero Hangul across the shared layer under EN', () => {
    const offenders = emitSharedLayer('en').filter((s) => HANGUL.test(s));
    expect(offenders).toEqual([]);
  });

  it('still renders Korean copy under KO (no accidental English hardcode)', () => {
    const strings = emitSharedLayer('ko');
    // The Korean side must remain fully Korean where copy is Korean — spot-check the
    // divider and sign-out so a future edit can't hardcode English into the base.
    expect(translateWeb('ko', 'auth.dividerOr')).toBe('또는');
    expect(translateWeb('ko', 'header.logout')).toBe('로그아웃');
    expect(strings.every((s) => s.trim().length > 0)).toBe(true);
  });
});
