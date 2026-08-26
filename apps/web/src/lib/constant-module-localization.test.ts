/**
 * Consolidated localization done-gate for the four domain constant/copy modules
 * (`recipients.ts`, `todo-copy.ts`, `onboarding-copy.ts`, `settings-copy.ts`).
 *
 * The per-module suites already prove KO→EN switching and interpolation. This
 * suite is the *aggregate* guard: it exercises every user-facing string all four
 * modules emit under `locale='en'` in one pass and locks two invariants that
 * define "done" for the constant-module localization effort:
 *
 *   1. The missing-key report is empty — no EN lookup fell back to Korean. This is
 *      the completion gate: a single un-catalogued key would surface here.
 *   2. No emitted string contains Hangul, with a single documented whitelist for
 *      the intentional endonym locale labels (`한국어 (Korean)`, `한국어`) — the only
 *      Korean text that is *supposed* to survive an EN switch anywhere in the app.
 *
 * These modules hold zero hardcoded Korean string values (the remaining Hangul in
 * each file is doc-comment prose, verified by grep). If a future edit reintroduces
 * a hardcoded Korean literal or drops a catalog key, this suite fails loudly.
 */

import { onboardingCopy } from './onboarding-copy';
import { recipientLabel, recipientMessages, validateRecipients } from './recipients';
import {
  filteredEmptyCopy,
  kanbanBoardCopy,
  nextActionCopy,
  pendingSignerLabel,
  summaryCopy,
  urgencyLabel,
  viewSwitcherCopy,
} from './todo-copy';
import { SETTINGS_NAV_ITEMS } from './settings-copy';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
  translateWeb,
} from './web-translations';
import type { SupportedLocale } from './locale';
import type { RecipientDraft } from '@/components/wizard/wizard-context';

/** Any precomposed Hangul syllable — the marker for un-migrated Korean copy. */
const HANGUL = /[가-힣]/;

/**
 * The only Korean strings allowed to survive an EN switch: endonym locale labels a
 * language picker must render in their own script. These live in the `settings` /
 * `header` namespaces, not in the four constant modules — so the whitelist is a
 * documented safety net, and its correctness is asserted separately below rather
 * than left to silently mask a real regression.
 */
const KOREAN_LABEL_WHITELIST = new Set(['한국어 (Korean)', '한국어']);

/** Every user-facing string a copy value recursively contains (nulls dropped). */
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

/**
 * Exercises every value-carrying string the four constant modules emit for a
 * locale. Deliberately excludes the intentional empty/null sentinels
 * (`urgencyLabel('NORMAL')`, `nextActionCopy(null)`, `pendingSignerLabel(0)`) —
 * they resolve no catalog key and carry no copy, so they neither affect key
 * coverage nor the empty-string guarantee.
 */
function emitAll(locale: SupportedLocale): unknown[] {
  const anonymous: RecipientDraft = { id: 'r1', email: 'a@x.com', name: '' };
  return [
    // recipients — order-based fallback label + all three validation messages
    recipientLabel(anonymous, 0, locale),
    recipientLabel(anonymous, 9, locale),
    recipientMessages(locale),
    validateRecipients([{ id: 'r1', email: '', name: '' }], locale),
    // todo — urgency, next-action, pending line, summary, filter, view switcher, kanban
    urgencyLabel('OVERDUE', locale),
    urgencyLabel('DUE_SOON', locale),
    nextActionCopy('SEND_DRAFT', locale),
    nextActionCopy('AWAITING_SIGN', locale),
    nextActionCopy('DOWNLOAD', locale),
    pendingSignerLabel(3, locale),
    summaryCopy(locale),
    filteredEmptyCopy(locale),
    viewSwitcherCopy(locale),
    kanbanBoardCopy(locale),
    // onboarding — full guide payload
    onboardingCopy(locale),
    // settings — pure structure; resolve the catalog keys its nav items point at
    SETTINGS_NAV_ITEMS.map((item) => translateWeb(locale, item.labelKey)),
  ];
}

describe('constant-module localization done-gate (EN)', () => {
  it('resolves every emitted key under EN with a zero missing-key report', () => {
    // The done gate: exercising all four modules in EN must leave the fallback
    // report empty — every emitted key resolves to real English copy.
    resetWebTranslationFallbackReport();
    emitAll('en');
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });

  it('emits zero non-whitelisted Hangul across all four modules under EN', () => {
    const offenders = collectStrings(emitAll('en')).filter(
      (s) => HANGUL.test(s) && !KOREAN_LABEL_WHITELIST.has(s),
    );
    expect(offenders).toEqual([]);
  });

  it('emits no empty user-facing string in either locale', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const s of collectStrings(emitAll(locale))) {
        expect(s.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('whitelists only the intentional endonym locale labels, which stay Korean under EN', () => {
    // Justify the whitelist: these keys really do render Korean endonyms even in EN
    // (a language picker shows each language in its own script). Asserting their
    // exact values means the whitelist can never quietly absorb an unrelated leak.
    expect(translateWeb('en', 'settings.korean')).toBe('한국어 (Korean)');
    expect(translateWeb('en', 'header.localeKo')).toBe('한국어');
    for (const label of KOREAN_LABEL_WHITELIST) {
      expect(HANGUL.test(label)).toBe(true);
    }
  });
});
