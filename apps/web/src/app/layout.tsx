import type { Metadata, Viewport } from 'next';
import './globals.css';
import { brandStyle } from '@/lib/branding';
import { fetchBrandingServer } from '@/lib/web-branding';
import { BrandingProvider } from '@/components/branding-provider';

export const metadata: Metadata = {
  title: '전자계약',
  description: '전자계약 SaaS',
};

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
  const branding = await fetchBrandingServer();

  return (
    <html lang="ko" style={brandStyle(branding.brandColor)}>
      <head>
        {branding.faviconUrl ? (
          <link rel="icon" href={branding.faviconUrl} data-branding="" />
        ) : null}
      </head>
      <body>
        <BrandingProvider initial={branding}>{children}</BrandingProvider>
      </body>
    </html>
  );
}
