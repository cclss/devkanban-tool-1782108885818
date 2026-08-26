import type { InterpolationVars, WebTranslationKey } from './web-translations';

/** Minimal translator signature — matches `useTranslation()` and `translateWeb` bound to a locale. */
export type Translate = (key: WebTranslationKey, vars?: InterpolationVars) => string;

/**
 * Localized relative "time ago" for card meta lines, shared by the contract and
 * template lists so both tell time in one voice (just now / N min / N hour / N day,
 * then an absolute `YYYY.MM.DD` past a week). Copy is never owned here — it comes
 * from the `time` namespace via the passed translator. Returns '' for an unparseable
 * timestamp so callers can drop the segment.
 */
export function formatRelativeTime(iso: string, t: Translate): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minutesAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('time.hoursAgo', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('time.daysAgo', { n: day });
  const d = new Date(then);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
