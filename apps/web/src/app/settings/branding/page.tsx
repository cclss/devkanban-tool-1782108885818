'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { BRANDING_COPY } from '@/lib/branding-settings';
import { BrandingSettings } from '@/components/branding/branding-settings';

/**
 * `/settings/branding` — admin "커스텀 브랜딩" (dashboard entry menu).
 *
 * Auth-guards like the dashboard (bounce unauthenticated visitors to login),
 * frames the page chrome, and hands the editor to <BrandingSettings />.
 */
export default function BrandingSettingsPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-md py-sm">
          <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-2xs rounded-md px-sm py-xs text-sm font-semibold text-foreground-subtle transition-colors duration-fast ease-standard hover:bg-grey-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
          >
            <BackIcon />
            {BRANDING_COPY.backToDashboard}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <nav aria-label="위치" className="flex items-center gap-2xs text-sm text-foreground-subtle">
          <span>{BRANDING_COPY.breadcrumbRoot}</span>
          <ChevronIcon />
          <span className="font-semibold text-foreground">{BRANDING_COPY.title}</span>
        </nav>

        <div className="mt-md flex flex-col gap-2xs">
          <h1 className="text-2xl font-bold text-foreground">{BRANDING_COPY.title}</h1>
          <p className="text-base text-foreground-subtle">{BRANDING_COPY.subtitle}</p>
        </div>

        <section className="mt-xl" aria-label={BRANDING_COPY.title}>
          <BrandingSettings />
        </section>
      </main>
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="m11.5 5-5 5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-grey-400" fill="none" aria-hidden="true">
      <path d="m8 5 4 5-4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
