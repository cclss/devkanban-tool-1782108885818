'use client';

/**
 * BrandingPreview — the read-only right panel of the 설정 → 브랜딩 screen.
 *
 * A presentation-only component: the parent (BrandingForm) owns the picked files,
 * the saved asset URLs, and the current 대표 색상, and passes them straight in.
 * This renders three live mockups of how those choices land across the service:
 *   1. Header mockup — the app top bar with the logo (or 전자계약 wordmark) and a
 *      brand-colored 설정 action, mirroring DashboardHeader.
 *   2. Browser-tab mockup — a tab showing the favicon (or a brand-colored
 *      monogram) beside the service name.
 *   3. Accent-color sample — a primary button/link/chip that re-skins to the
 *      chosen color, mirroring the color picker's own preview.
 *
 * Real-time by construction: the whole panel carries `brandStyle(color)` on its
 * root, so every primary token re-skins the instant the color prop changes; the
 * logo/favicon sources resolve through the shared `resolveImageUploaderView`
 * helper (picked > saved > empty), so a newly picked File shows immediately and
 * an empty asset falls back to the wordmark / monogram. Local object URLs for the
 * picked files are managed by `createObjectUrlLifecycle`, so previews never leak
 * (revoke on replace and on unmount) — the same guarantee the uploader gives.
 *
 * No network, no form state, no layout ownership (the 2-단 grid + sticky wrapper
 * are the form's concern, a later grain). All chrome reuses existing `globals.css`
 * tokens; the only literal color anywhere is the user's own picked value carried
 * by `brandStyle`, which is data, not a token. The mockups are decorative
 * (`aria-hidden`) — the form fields already convey each chosen value.
 */

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import {
  resolveImageUploaderView,
  createObjectUrlLifecycle,
  type ObjectUrlLifecycle,
} from '@/lib/image-uploader-view';
import { useTranslation } from '@/components/locale-provider';

export interface BrandingPreviewProps {
  /** The newly picked logo file, or `null` when none is selected. */
  logoFile: File | null;
  /** URL of the logo already saved on the server, or `null`/absent. */
  logoSavedUrl?: string | null;
  /** The newly picked favicon file, or `null` when none is selected. */
  faviconFile: File | null;
  /** URL of the favicon already saved on the server, or `null`/absent. */
  faviconSavedUrl?: string | null;
  /**
   * The current 대표 색상 (`#rgb` / `#rrggbb`), or empty when unset. Applied via
   * `brandStyle`, which no-ops on an invalid value so the default tokens hold.
   */
  color: string;
  className?: string;
}

/**
 * Object URL for a picked file, revoked on replace and unmount. Mirrors the
 * ImageUploader's lifecycle so the preview blob never leaks (M10 = 0). Returns
 * `null` while no file is held or before the blob URL is ready.
 */
function usePickedUrl(file: File | null): string | null {
  const lifecycleRef = React.useRef<ObjectUrlLifecycle | null>(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = createObjectUrlLifecycle({
      create: (source) => URL.createObjectURL(source as Blob),
      revoke: (url) => URL.revokeObjectURL(url),
    });
  }
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    setUrl(lifecycleRef.current!.set(file));
  }, [file]);
  React.useEffect(() => () => lifecycleRef.current!.dispose(), []);
  return url;
}

export function BrandingPreview({
  logoFile,
  logoSavedUrl,
  faviconFile,
  faviconSavedUrl,
  color,
  className,
}: BrandingPreviewProps) {
  const t = useTranslation();
  const logoPickedUrl = usePickedUrl(logoFile);
  const faviconPickedUrl = usePickedUrl(faviconFile);

  // picked > saved > empty. `previewUrl` is only set once the blob URL is ready,
  // so a mid-pick frame never mis-renders as saved.
  const logoView = resolveImageUploaderView({
    pickedUrl: logoFile ? logoPickedUrl : null,
    savedUrl: logoSavedUrl,
  });
  const faviconView = resolveImageUploaderView({
    pickedUrl: faviconFile ? faviconPickedUrl : null,
    savedUrl: faviconSavedUrl,
  });

  // Monogram fallback for the favicon derives from the service name's first
  // character, so a rename stays single-source with the wordmark.
  const monogram = t('header.wordmark').slice(0, 1);

  return (
    // brandStyle re-skins every primary token in this subtree; {} on an invalid
    // color leaves the default tokens in force (empty-color fallback).
    <div className={cn('flex flex-col gap-lg', className)} style={brandStyle(color)}>
      <div className="flex flex-col gap-2xs">
        <h2 className="text-md font-bold text-foreground">{t('branding.previewTitle')}</h2>
        <p className="text-sm text-foreground-subtle">{t('branding.previewDescription')}</p>
      </div>

      {/* Header mockup — mirrors DashboardHeader's brand mark + settings entry. */}
      <figure className="flex flex-col gap-xs" aria-hidden="true">
        <figcaption className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          {t('branding.previewHeaderLabel')}
        </figcaption>
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between gap-sm border-b border-border px-md py-sm">
            {logoView.kind === 'empty' ? (
              <span className="text-base font-bold tracking-tight text-primary">
                {t('header.wordmark')}
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- branded logo preview, arbitrary host/type
              <img
                src={logoView.url}
                alt={t('branding.previewLogoAlt')}
                className="h-7 w-auto max-w-[160px] object-contain"
              />
            )}
            <span className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-md text-xs font-semibold text-primary-foreground">
              {t('settings.title')}
            </span>
          </div>
          {/* Body skeleton — hints at page content without inventing copy. */}
          <div className="flex flex-col gap-xs px-md py-md">
            <span className="h-2xs w-1/2 rounded-full bg-surface-muted" />
            <span className="h-2xs w-3/4 rounded-full bg-surface-muted" />
          </div>
        </div>
      </figure>

      {/* Browser-tab mockup — favicon (or monogram) beside the service name. */}
      <figure className="flex flex-col gap-xs" aria-hidden="true">
        <figcaption className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          {t('branding.previewTabLabel')}
        </figcaption>
        <div className="flex flex-col gap-2xs rounded-lg border border-border bg-surface-muted p-xs shadow-sm">
          <div className="flex items-center">
            <span className="flex max-w-[200px] items-center gap-2xs rounded-t-md border border-b-0 border-border bg-surface px-sm py-2xs">
              {faviconView.kind === 'empty' ? (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary text-2xs font-bold leading-none text-primary-foreground">
                  {monogram}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- branded favicon preview, arbitrary host/type
                <img
                  src={faviconView.url}
                  alt={t('branding.previewFaviconAlt')}
                  className="h-4 w-4 shrink-0 rounded-sm object-contain"
                />
              )}
              <span className="truncate text-xs font-medium text-foreground">
                {t('header.wordmark')}
              </span>
            </span>
          </div>
          {/* Address-bar hint — a neutral pill, no fabricated URL. */}
          <div className="flex items-center gap-xs rounded-md border border-border bg-surface px-sm py-2xs">
            <span className="h-2xs w-2xs shrink-0 rounded-full bg-border-strong" />
            <span className="h-2xs w-1/3 rounded-full bg-surface-muted" />
          </div>
        </div>
      </figure>

      {/* Accent-color sample — primary elements re-skin to the chosen color. */}
      <figure className="flex flex-col gap-xs" aria-hidden="true">
        <figcaption className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          {t('branding.previewColorLabel')}
        </figcaption>
        <div className="flex flex-wrap items-center gap-md rounded-lg border border-border bg-surface p-md">
          <Button type="button" variant="primary" size="sm" tabIndex={-1}>
            {t('branding.colorPreviewButton')}
          </Button>
          <span className="text-sm font-semibold text-primary underline underline-offset-2">
            {t('branding.colorPreviewLink')}
          </span>
          {color ? (
            <span className="ml-auto inline-flex items-center rounded-full bg-primary-subtle px-md py-2xs text-xs font-semibold uppercase text-primary">
              {color}
            </span>
          ) : null}
        </div>
      </figure>
    </div>
  );
}
