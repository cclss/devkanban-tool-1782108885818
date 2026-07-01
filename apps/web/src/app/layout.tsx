import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '전자계약',
  description: '전자계약 SaaS',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Extend content under the notch/home indicator so `env(safe-area-inset-*)`
  // resolves to non-zero on iOS — required by the `.*-safe` utilities in
  // globals.css. Screens opt into the insets via those utilities.
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
