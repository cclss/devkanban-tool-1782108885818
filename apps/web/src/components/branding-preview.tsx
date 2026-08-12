'use client';

/**
 * BrandingPreview — the 실시간 미리보기 패널 for the branding form.
 *
 * A controlled, network-free presentation component. It mirrors the form's
 * current values back as three "how it lands across the service" mockups:
 *
 *   • 헤더 로고 — the app top bar's brand mark (matches `DashboardHeader`): the
 *     logo image when one is in force, else the 전자계약 wordmark.
 *   • 브라우저 탭 — a browser-tab chip carrying the favicon (or a default
 *     monogram) beside the service name.
 *   • 대표 색상 — a small re-skin sample (primary button · link · chip) so the
 *     picked color is shown exactly as it will apply.
 *
 * Image precedence per asset is the same one the uploader rests on — a newly
 * picked `File` (shown via a local object URL) wins over the already-stored
 * asset URL, which wins over the unset fallback — so it defers to the single
 * source of that ordering (`resolveImageUploaderView`) rather than re-deriving
 * it. The stored URLs are the runtime's `?v=`-versioned ones, so a save's fresh
 * asset shows the moment the form swaps them in.
 *
 * Color: the whole panel carries the `--brand-*` hook via `brandStyle(color)`,
 * so every primary-tinted sample (wordmark, monogram, button, link, chip)
 * re-skins to the picked color live — no per-element wiring. An invalid/empty
 * color yields no override, so the default tokens hold.
 *
 * All chrome reuses existing `globals.css` tokens; no new colors, spacing, or
 * radii. The mockup images are decorative (`alt=""`) — each block's caption
 * carries the accessible name, matching the uploader's thumbnail a11y rule.
 */

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { resolveImageUploaderView } from '@/lib/image-uploader-view';
import { HEADER_BRAND_COPY, BRANDING_PREVIEW_COPY } from '@/lib/settings-copy';

export interface BrandingPreviewProps {
  /** Newly picked logo file (unsaved), or `null`. Wins over the stored URL. */
  logoFile?: File | null;
  /** Newly picked favicon file (unsaved), or `null`. Wins over the stored URL. */
  faviconFile?: File | null;
  /** Already-stored logo URL (runtime, `?v=` versioned), or `null` when unset. */
  logoUrl?: string | null;
  /** Already-stored favicon URL (runtime, `?v=` versioned), or `null` when unset. */
  faviconUrl?: string | null;
  /** Current brand color (`#rgb`/`#rrggbb`); invalid/empty → default tokens. */
  color?: string;
  className?: string;
}

/**
 * Derive a live object URL from a picked file, revoking it on change/unmount so
 * blobs never leak. Returns `null` when no file is held (or before the URL is
 * derived on the first frame).
 */
function useObjectUrl(file: File | null | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

/** Newly picked file (object URL) > stored asset URL > `null` (unset fallback). */
function useAssetSource(file: File | null | undefined, currentUrl: string | null | undefined): string | null {
  const previewUrl = useObjectUrl(file);
  const view = resolveImageUploaderView({ hasFile: Boolean(file), previewUrl, currentUrl });
  if (view.kind === 'file') return view.previewUrl;
  if (view.kind === 'saved') return view.url;
  return null;
}

export function BrandingPreview({
  logoFile,
  faviconFile,
  logoUrl,
  faviconUrl,
  color,
  className,
}: BrandingPreviewProps) {
  const logoSrc = useAssetSource(logoFile, logoUrl);
  const faviconSrc = useAssetSource(faviconFile, faviconUrl);
  const monogram = HEADER_BRAND_COPY.wordmark.charAt(0);

  return (
    <section
      aria-label={BRANDING_PREVIEW_COPY.title}
      style={brandStyle(color)}
      className={cn('flex flex-col gap-lg rounded-lg border border-border bg-surface-muted p-lg', className)}
    >
      <div className="flex flex-col gap-2xs">
        <h3 className="text-sm font-bold text-foreground">{BRANDING_PREVIEW_COPY.title}</h3>
        <p className="text-xs text-foreground-subtle">{BRANDING_PREVIEW_COPY.description}</p>
      </div>

      {/* 헤더 로고 — the app top bar mark, mirroring DashboardHeader. */}
      <PreviewBlock
        label={BRANDING_PREVIEW_COPY.logoLabel}
        hint={logoSrc ? null : BRANDING_PREVIEW_COPY.logoEmpty}
      >
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-md py-sm">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- branded logo, arbitrary host and type (SVG/PNG)
            <img src={logoSrc} alt="" className="h-7 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="text-base font-bold tracking-tight text-primary">
              {HEADER_BRAND_COPY.wordmark}
            </span>
          )}
          {/* Decorative faux nav, so the mark reads as a real header bar. */}
          <span aria-hidden="true" className="flex items-center gap-2xs">
            <span className="h-6 w-12 rounded-md bg-surface" />
            <span className="h-6 w-12 rounded-md bg-surface" />
          </span>
        </div>
      </PreviewBlock>

      {/* 브라우저 탭 — the favicon as it shows in a browser tab. */}
      <PreviewBlock
        label={BRANDING_PREVIEW_COPY.faviconLabel}
        hint={faviconSrc ? null : BRANDING_PREVIEW_COPY.faviconEmpty}
      >
        <div className="flex items-center gap-xs rounded-md border border-border bg-surface px-sm py-xs shadow-sm">
          {faviconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- branded favicon, arbitrary host and type (SVG/PNG)
            <img src={faviconSrc} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary-subtle text-2xs font-bold text-primary"
            >
              {monogram}
            </span>
          )}
          <span className="max-w-[140px] truncate text-xs font-semibold text-foreground">
            {HEADER_BRAND_COPY.wordmark}
          </span>
          <span aria-hidden="true" className="text-sm leading-none text-foreground-subtle">
            ×
          </span>
        </div>
      </PreviewBlock>

      {/* 대표 색상 — a re-skin sample; primary accents follow --brand-* live. */}
      <PreviewBlock label={BRANDING_PREVIEW_COPY.colorLabel}>
        <div className="flex flex-wrap items-center gap-md rounded-lg border border-border bg-surface p-md">
          <Button type="button" variant="primary" size="sm" tabIndex={-1}>
            {BRANDING_PREVIEW_COPY.colorSampleButton}
          </Button>
          <span className="text-sm font-semibold text-primary underline underline-offset-2">
            {BRANDING_PREVIEW_COPY.colorSampleLink}
          </span>
        </div>
      </PreviewBlock>
    </section>
  );
}

/**
 * Shared wrapper for one preview mockup: a caption, the mockup itself, and an
 * optional unset hint below. Same structure/tokens for all three so the panel
 * stays visually consistent.
 */
function PreviewBlock({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-xs">
      <span className="text-xs font-semibold text-foreground-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-foreground-subtle">{hint}</span> : null}
    </div>
  );
}
