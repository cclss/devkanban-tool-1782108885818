'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@repo/ui';
import type { SettingsNavItem } from '@/lib/settings-copy';

/**
 * SettingsNav — the persistent settings menu. A vertical list of links, one per
 * settings sub-section, with exactly one item marked as the current section.
 *
 * Design decisions (design-spec `components/settings-nav/base.md`):
 * - It is navigation, not a control: items are real `<a>` links inside a labelled
 *   `<nav>`, so the browser/back-forward and "open in new tab" work. The active
 *   item carries `aria-current="page"` — the standard way to tell assistive tech
 *   "this is the section you're on".
 * - Never color alone (shared accessibility rule with ViewSwitcher / summary-card):
 *   the selected item is signalled by *form* as well as hue — a filled
 *   `primary-subtle` chip and a heavier font weight — reusing the dashboard's
 *   AA-verified "actionable = primary" language. No new colors/tokens.
 *
 * This component owns structure/selection presentation but NOT the item copy:
 * labels come in via `items` (source of truth: `lib/settings-copy.ts` →
 * design-spec/messaging/settings-copy.md), exactly like ViewSwitcher takes its
 * labels as props.
 */
export interface SettingsNavProps {
  /** Menu items in render order (source: lib/settings-copy.ts). */
  items: readonly SettingsNavItem[];
  /** Accessible name for the nav landmark, e.g. "설정 메뉴". */
  label: string;
  className?: string;
}

export function SettingsNav({ items, label, className }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={cn('flex flex-col gap-2xs', className)}>
      {items.map((item) => {
        // Active when on the item's route or any nested route under it, so a
        // deeper settings page keeps its top-level section highlighted.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-sm py-xs text-sm transition-colors duration-fast ease-standard',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
              active
                ? 'bg-primary-subtle font-semibold text-primary'
                : 'font-medium text-foreground-subtle hover:bg-surface-muted hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
