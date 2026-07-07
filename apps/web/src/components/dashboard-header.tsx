'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@repo/ui';
import type { SessionUser } from '@/lib/auth';
import { SETTINGS_ENTRY_LABEL, SETTINGS_DEFAULT_ROUTE } from '@/lib/settings-copy';

/**
 * DashboardHeader — the app's top bar for the authenticated sender area. Shared
 * across the dashboard and the settings section so the wordmark, settings entry
 * point, and sign-out live in one place.
 *
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
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-md py-sm">
        <Link
          href="/dashboard"
          className="rounded-sm text-base font-bold tracking-tight text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
        >
          전자계약
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
