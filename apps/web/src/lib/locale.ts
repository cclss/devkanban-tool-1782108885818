/**
 * Locale primitives shared by the authenticated app and public-link flows.
 *
 * The API remains the source of the resource catalog; this module only decides
 * which of its two published catalogs the browser should request. Keeping the
 * decision pure makes the client follow the same precedence as the API.
 */

import { apiFetch } from './api';

export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleResolutionInput {
  /** Persisted preference of the currently authenticated user. */
  userLocale?: string | null;
  /** Persisted preference of the sender of a public link. */
  senderLocale?: string | null;
  /** Browser language tags, in browser preference order. */
  browserLanguages?: readonly string[] | null;
}

export interface TranslationResources {
  locale: SupportedLocale;
  resources: Record<string, unknown>;
}

/** Normalise `en-US` / `ko_KR` tags into one of the published locales. */
export function parseLocale(value?: string | null): SupportedLocale | undefined {
  if (!value) return undefined;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === language);
}

/** First supported browser preference, ignoring unsupported language tags. */
export function localeFromBrowserLanguages(
  languages?: readonly string[] | null,
): SupportedLocale | undefined {
  return languages?.map(parseLocale).find((locale): locale is SupportedLocale => !!locale);
}

/** Resolve: signed-in user → public-link sender → browser → English. */
export function resolveLocale(input: LocaleResolutionInput = {}): SupportedLocale {
  return (
    parseLocale(input.userLocale) ??
    parseLocale(input.senderLocale) ??
    localeFromBrowserLanguages(input.browserLanguages) ??
    'en'
  );
}

/**
 * Cookie the web app mirrors the saved locale into (non-HttpOnly), so a server
 * component can honour a signed-in user's preference on the first paint — the
 * same SSR-readable pattern the auth token cookie already uses. `localStorage`
 * remains the client source of truth; this cookie only exists for SSR.
 */
export const LOCALE_COOKIE = 'esign_locale';

/**
 * Parse an HTTP `Accept-Language` header into language tags in browser
 * preference order. Sorts by q-value (absent q defaults to 1), drops q=0 and
 * malformed weights, and leaves normalisation to {@link localeFromBrowserLanguages}.
 */
export function parseAcceptLanguage(header?: string | null): readonly string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(';');
      const weight = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
      const quality = weight ? Number.parseFloat(weight.slice(2)) : 1;
      return { tag: (rawTag ?? '').trim(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}

/**
 * Server-side locale for the initial paint. Precedence mirrors
 * {@link resolveLocale}: the saved-locale cookie (a signed-in user's stored
 * preference) → `Accept-Language` browser order → English. Keeping it pure lets
 * SSR follow the same contract as the client without importing request APIs.
 */
export function resolveServerLocale(input: {
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): SupportedLocale {
  return resolveLocale({
    userLocale: input.cookieLocale,
    browserLanguages: parseAcceptLanguage(input.acceptLanguage),
  });
}

/** Browser-facing lookup for the API's read-only translation resources. */
export function fetchTranslationResources(locale: SupportedLocale): Promise<TranslationResources> {
  return apiFetch<TranslationResources>(`/i18n/resources/${locale}`);
}

/** Read browser preferences without making SSR or storage availability assumptions. */
export function getBrowserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}
