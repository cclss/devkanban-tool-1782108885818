import { redirect } from 'next/navigation';
import { SETTINGS_DEFAULT_ROUTE } from '@/lib/settings-copy';

/**
 * `/settings` has no page of its own — it forwards to the default sub-section
 * (브랜딩), so entering settings always lands on a real, selected section.
 * `force-dynamic` keeps this an actual request-time HTTP redirect (not a
 * statically prerendered page), so a hard navigation to `/settings` forwards
 * deterministically.
 */
export const dynamic = 'force-dynamic';

export default function SettingsIndexPage() {
  redirect(SETTINGS_DEFAULT_ROUTE);
}
