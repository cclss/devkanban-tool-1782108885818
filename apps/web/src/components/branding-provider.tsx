'use client';

/**
 * BrandingProvider — the app-wide runtime that reflects saved service branding.
 *
 * Mounted once at the root layout, wrapping the whole app (dashboard, settings,
 * auth, signer — brand color and favicon are global, applied everywhere). It is
 * seeded with the branding the server fetched for the initial paint (so there's
 * no flash of the default color/icon), then keeps things live on the client:
 *
 *   • Brand color → the `--brand-*` hook on `<html>`, via `brandStyle()`. The
 *     server also sets these vars inline on `<html>` for the first paint; this
 *     effect mirrors them so a `refresh()` re-skins without a reload.
 *   • Favicon → a single reconciled `<link rel="icon" data-branding>` in <head>.
 *   • Logo → exposed through `useBranding()` for the header to render.
 *
 * `refresh()` re-fetches `GET /branding` and re-applies immediately — the hook a
 * save flow calls so the header logo / favicon / color update the moment the
 * admin saves, with no page reload.
 */

import * as React from 'react';
import { brandStyle } from '@/lib/branding';
import { EMPTY_BRANDING, fetchBranding, type Branding } from '@/lib/web-branding';

interface BrandingContextValue {
  /** Current branding in force (absolute asset URLs; nulls → defaults). */
  branding: Branding;
  /** Re-fetch `GET /branding` and re-apply immediately. Call after a save. */
  refresh: () => Promise<void>;
}

const BrandingContext = React.createContext<BrandingContextValue | null>(null);

/** The `--brand-*` custom properties `brandStyle()` fills (all of them). */
const BRAND_VARS = [
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-pressed',
  '--brand-primary-subtle',
] as const;

/**
 * Reconcile the branded favicon link in <head>. Updates in place (never
 * remove-then-add) so switching never flashes the default icon. A null URL
 * removes the branded link, letting the document's default icon show.
 */
function applyFavicon(faviconUrl: string | null): void {
  if (typeof document === 'undefined') return;
  const head = document.head;
  let link = head.querySelector<HTMLLinkElement>('link[rel~="icon"][data-branding]');
  if (!faviconUrl) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('data-branding', '');
    head.appendChild(link);
  }
  if (link.getAttribute('href') !== faviconUrl) {
    link.setAttribute('href', faviconUrl);
  }
}

/**
 * Apply the brand color vars to `<html>` so the whole app re-skins (global
 * scope — every primary-tinted token inherits `--brand-primary`). A null/invalid
 * color clears the overrides so the default tokens in `globals.css` take over.
 */
function applyBrandVars(brandColor: string | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = brandStyle(brandColor) as Record<string, string | undefined>;
  for (const name of BRAND_VARS) {
    const value = vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}

export function BrandingProvider({
  initial,
  children,
}: {
  initial: Branding;
  children: React.ReactNode;
}) {
  const [branding, setBranding] = React.useState<Branding>(initial ?? EMPTY_BRANDING);

  // Favicon: the SSR-rendered <link> covers first paint; keep it reconciled on
  // the client so a live refresh() swaps the tab icon without a reload.
  React.useEffect(() => {
    applyFavicon(branding.faviconUrl);
  }, [branding.faviconUrl]);

  // Brand color: SSR sets these vars inline on <html> for a no-flash first paint;
  // mirror onto <html> here so a live refresh() re-skins the app immediately.
  React.useEffect(() => {
    applyBrandVars(branding.brandColor);
  }, [branding.brandColor]);

  const refresh = React.useCallback(async () => {
    try {
      setBranding(await fetchBranding());
    } catch {
      // Keep the last-known branding on a transient failure — never blank the app.
    }
  }, []);

  const value = React.useMemo<BrandingContextValue>(
    () => ({ branding, refresh }),
    [branding, refresh],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/**
 * Read the current branding and the refresh hook. Returns a safe default
 * (empty branding, no-op refresh) when used outside a provider, so a component
 * never crashes for lack of context.
 */
export function useBranding(): BrandingContextValue {
  const ctx = React.useContext(BrandingContext);
  if (ctx) return ctx;
  return { branding: EMPTY_BRANDING, refresh: async () => {} };
}
