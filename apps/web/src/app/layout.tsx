import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { brandStyle } from '@/lib/branding';
import { fetchBrandingServer } from '@/lib/web-branding';
import { LOCALE_COOKIE, resolveServerLocale, type SupportedLocale } from '@/lib/locale';
import { translateWeb } from '@/lib/web-translations';
import { BrandingProvider } from '@/components/branding-provider';
import { LocaleProvider } from '@/components/locale-provider';
import { WebTranslationDiagnostics } from '@/components/web-translation-diagnostics';

/**
 * Resolve the locale for the server's initial paint from request state: the
 * saved-locale cookie (a signed-in user's stored preference) first, then the
 * browser's `Accept-Language`, then Korean. The client `LocaleProvider` re-runs
 * the full precedence once mounted and keeps the live switch, so this is only
 * the no-flash seed for `<html lang>` and the document metadata.
 */
async function resolveInitialLocale(): Promise<SupportedLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveServerLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  });
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveInitialLocale();
  return {
    title: translateWeb(locale, 'meta.title'),
    description: translateWeb(locale, 'meta.description'),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout also mounts the global branding runtime. Branding is fetched on
 * the server so the initial paint already carries the saved brand color (inline
 * `--brand-*` vars on `<html>`) and favicon (a `<link rel="icon">` in <head>) —
 * no flash of the defaults. The client `BrandingProvider` takes the same value
 * as its seed and keeps everything live (and exposes `refresh()` for saves).
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [branding, locale] = await Promise.all([
    fetchBrandingServer(),
    resolveInitialLocale(),
  ]);

  return (
    <html lang={locale} style={brandStyle(branding.brandColor)}>
      <head>
        {branding.faviconUrl ? (
          <link rel="icon" href={branding.faviconUrl} data-branding="" />
        ) : null}
      </head>
      <body>
        <LocaleProvider>
          <BrandingProvider initial={branding}>{children}</BrandingProvider>
          <WebTranslationDiagnostics />
        </LocaleProvider>
      </body>
    </html>
  );
}
