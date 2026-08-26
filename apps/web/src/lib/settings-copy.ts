/**
 * Settings section structure — the routes and navigation shape of the settings
 * shell. User-facing copy no longer lives here: every label/heading/description
 * is resolved from the web translation catalog (`settings` / `branding` / `header`
 * namespaces) at the consumer via `useTranslation`, so switching the locale
 * re-renders the settings surface with no hardcoded Korean.
 *
 * What remains is pure structure — routes and the catalog *key* each nav item
 * points at — which is locale-independent by design.
 */

import type { WebTranslationKey } from './web-translations';

/** A single item in the settings navigation. `href` is the sub-section route. */
export interface SettingsNavItem {
  /** Route this item links to, e.g. `/settings/branding`. */
  href: string;
  /** Catalog key for this item's label, e.g. `settings.branding`. */
  labelKey: WebTranslationKey;
}

/**
 * Settings sub-sections, in menu order. Only sections with a real page live
 * here — no dead links. Future settings append to this list and the shell/nav
 * pick them up with no structural change; each carries the catalog key for its
 * localized label.
 */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { href: '/settings/branding', labelKey: 'settings.branding' },
  { href: '/settings/language', labelKey: 'settings.language' },
];

/** The default settings sub-section landed on when entering `/settings`. */
export const SETTINGS_DEFAULT_ROUTE = '/settings/branding';
