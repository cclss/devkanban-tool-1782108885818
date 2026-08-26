'use client';

import * as React from 'react';
import { cn } from '@repo/ui';
import { applyLocalePreference, updateLocale } from '@/lib/auth';
import { useLocale, useTranslation } from '@/components/locale-provider';
import type { SupportedLocale } from '@/lib/locale';

/**
 * LanguageSwitch — the global KO/EN language toggle mounted in the app header, so
 * a signed-in sender can flip the whole UI's language from anywhere (dashboard,
 * settings, templates) without visiting the settings page.
 *
 * Interaction model (immediate apply, then confirm):
 * - On selection it calls {@link applyLocalePreference} first, which patches the
 *   stored preference + SSR cookie and fires `esign:session-change`. That flips
 *   `LocaleProvider` and `<html lang>` *optimistically*, before any network round
 *   trip, so the switch feels instant.
 * - It then calls {@link updateLocale} to persist the choice on the server for
 *   cross-session durability. If that fails, the optimistic apply is rolled back
 *   to the previous locale and a compact error is shown — the UI never sits in a
 *   language the server did not accept.
 *
 * Accessibility / tokens reuse the ViewSwitcher segmented-control pattern
 * (design-spec `components/view-switcher/base.md`): a `role="radiogroup"` of
 * `role="radio"` segments with `aria-checked`, roving tabindex + arrow keys, and
 * the AA-verified `primary-subtle` / `text-primary` "active = primary" language
 * signalled by form (filled chip + heavier weight) as well as hue — never color
 * alone.
 */

/** Render order of the segments (left → right). Korean is the product default. */
const LOCALE_ORDER: readonly SupportedLocale[] = ['ko', 'en'];

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale } = useLocale();
  const t = useTranslation();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [pending, setPending] = React.useState<SupportedLocale | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Show the optimistic target while a save is in flight; otherwise the live
  // resolved locale from the provider.
  const selected = pending ?? locale;

  const choose = React.useCallback(
    async (next: SupportedLocale) => {
      // Ignore no-ops and re-entrancy while a save is still resolving.
      if (pending || next === selected) return;
      const previous = locale;
      setError(null);
      setPending(next);
      // Optimistic immediate apply: event → LocaleProvider re-render, <html lang>.
      applyLocalePreference(next);
      try {
        // Durable, cross-session persistence (localStorage + cookie + API).
        await updateLocale(next);
      } catch {
        // Roll back the optimistic apply so the UI never keeps an unsaved locale.
        applyLocalePreference(previous);
        setError(t('settings.saveFailed'));
      } finally {
        setPending(null);
      }
    },
    [locale, pending, selected, t],
  );

  // Roving focus: arrows move selection (and focus) between segments, wrapping at
  // the ends — the standard radiogroup keyboard model shared with ViewSwitcher.
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const delta = forward ? 1 : -1;
    const nextIndex = (index + delta + LOCALE_ORDER.length) % LOCALE_ORDER.length;
    const nextLocale = LOCALE_ORDER[nextIndex];
    if (!nextLocale) return;
    refs.current[nextIndex]?.focus();
    void choose(nextLocale);
  };

  return (
    <div className={cn('flex flex-col items-end gap-2xs', className)}>
      <div
        role="radiogroup"
        aria-label={t('header.languageSwitchLabel')}
        className="inline-flex items-center gap-2xs rounded-lg border border-border bg-surface p-2xs"
      >
        {LOCALE_ORDER.map((value, index) => {
          const active = value === selected;
          const label = value === 'ko' ? t('header.localeKo') : t('header.localeEn');
          return (
            <button
              key={value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              // Roving tabindex: only the active segment is in the tab order.
              tabIndex={active ? 0 : -1}
              onClick={() => void choose(value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'rounded-md px-sm py-2xs text-sm transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                active
                  ? 'bg-primary-subtle font-semibold text-primary'
                  : 'font-medium text-foreground-subtle hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
