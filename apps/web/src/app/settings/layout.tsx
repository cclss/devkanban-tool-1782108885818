'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { SettingsNav } from '@/components/settings-nav';
import { clearSession, getToken, getUser, type SessionUser } from '@/lib/auth';
import {
  SETTINGS_NAV_ITEMS,
  type SettingsNavItem,
} from '@/lib/settings-copy';
import { useTranslation } from '@/components/locale-provider';

/**
 * Settings shell. Wraps every `/settings/*` page with the shared app header, a
 * section title, and the persistent settings menu (nav aside on desktop, stacked
 * on top on mobile). The active menu item is resolved by `SettingsNav` from the
 * current route, so navigating between sub-sections keeps the shell mounted and
 * only swaps the content column.
 *
 * Auth reuses the existing client-side session pattern (same as the dashboard):
 * no session token → bounce to /login. No new admin/permission gating is added.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslation();
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setReady(true);
  }, [router]);

  if (!ready) return null;

  const items: SettingsNavItem[] = SETTINGS_NAV_ITEMS.map((item) => ({
    ...item,
    label:
      item.href === '/settings/branding'
        ? t('settings.branding')
        : item.href === '/settings/language'
          ? t('settings.language')
          : item.label,
  }));

  return (
    <div className="min-h-[100dvh] bg-background">
      <DashboardHeader
        user={user}
        onLogout={() => {
          clearSession();
          router.replace('/login');
        }}
      />

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>

        <div className="mt-xl flex flex-col gap-lg sm:flex-row sm:items-start sm:gap-xl">
          <SettingsNav
            items={items}
            label={t('settings.navLabel')}
            className="w-full sm:w-[180px] sm:shrink-0"
          />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  );
}
