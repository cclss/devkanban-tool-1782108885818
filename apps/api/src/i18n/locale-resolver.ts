/** The only locales the product currently publishes. */
export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleResolutionInput {
  /** Persisted preference of an authenticated user. */
  userLocale?: string | null;
  /** Locale of the sender who created a public signing/share link. */
  senderLocale?: string | null;
  /** Raw HTTP Accept-Language header. */
  acceptLanguage?: string | null;
}

/** Normalise stored locales and browser tags (for example `en-US`). */
export function parseLocale(value?: string | null): SupportedLocale | undefined {
  if (!value) return undefined;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LOCALES.find((locale) => locale === language);
}

/** Select the first supported browser language in header preference order. */
export function localeFromAcceptLanguage(header?: string | null): SupportedLocale | undefined {
  if (!header) return undefined;

  return header
    .split(',')
    .map((entry, index) => {
      const [tag, ...params] = entry.trim().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      const q = quality ? Number(quality.trim().slice(2)) : 1;
      return { locale: parseLocale(tag), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((candidate) => candidate.locale && candidate.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.locale;
}

/** Resolve locale: authenticated user → sender → browser → Korean default. */
export function resolveLocale(input: LocaleResolutionInput = {}): SupportedLocale {
  return (
    parseLocale(input.userLocale) ??
    parseLocale(input.senderLocale) ??
    localeFromAcceptLanguage(input.acceptLanguage) ??
    'ko'
  );
}
