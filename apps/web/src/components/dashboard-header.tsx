'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@repo/ui';
import type { SessionUser } from '@/lib/auth';
import { useBranding } from '@/components/branding-provider';
import {
  HEADER_BRAND_COPY,
  SETTINGS_ENTRY_LABEL,
  SETTINGS_DEFAULT_ROUTE,
} from '@/lib/settings-copy';

/**
 * DashboardHeader — the app's top bar for the authenticated sender area. Shared
 * across the dashboard and the settings section so the brand mark, settings
 * entry point, and sign-out live in one place.
 *
 * Brand mark: when a branding logo is set it renders as an image (alt text from
 * copy, height-constrained to the header line, `object-contain`); otherwise the
 * 전자계약 wordmark shows. Either way it links home and shares one focus ring.
 * Layout/tone reuse the established token language (sticky surface bar with a
 * bottom border, `max-w-[960px]` content column). The `설정` entry is a ghost
 * link to the settings section — the single doorway into `/settings` from the
 * authenticated app.
 */
export function DashboardHeader({
  user,
  onLogout,
}: {
  user: SessionUser | null;
  onLogout: () => void;
}) {
  const { branding } = useBranding();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-md py-sm">
        <Link
          href="/dashboard"
          className="flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
        >
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- branded logo, arbitrary host and type (SVG/PNG)
            <img
              src={branding.logoUrl}
              alt={HEADER_BRAND_COPY.logoAlt}
              className="h-7 w-auto max-w-[160px] object-contain"
            />
          ) : (
            <span className="text-base font-bold tracking-tight text-primary">
              {HEADER_BRAND_COPY.wordmark}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-xs">
          {user?.email ? (
            <span className="hidden text-sm text-foreground-subtle sm:inline">{user.email}</span>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link href={SETTINGS_DEFAULT_ROUTE}>{SETTINGS_ENTRY_LABEL}</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            로그아웃
          </Button>
        </div>
      </div>
    </header>
  );
}
