'use client';

/**
 * BrandingPreview — a live mock of the signer screen that re-skins as the admin
 * edits color/font/logo.
 *
 * It mirrors the real signer chrome (sender header, primary CTA, link, body
 * text) but is an independent mock — per the grain boundary, the actual signer
 * components stay untouched. The brand color is applied via `brandStyle()` on
 * the wrapper (the same `--brand-*` hook the signer uses), and the font via the
 * `font-*` family utility, so every primary accent + all text inside re-skins
 * with no per-element overrides.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { BRANDING_COPY, expandHex, fontClassName, type BrandFont } from '@/lib/branding-settings';

export function BrandingPreview({
  color,
  font,
  logoUrl,
  className,
}: {
  /** Current hex text — applied only when it's a valid color. */
  color: string;
  font: BrandFont;
  logoUrl: string | null;
  className?: string;
}) {
  const validColor = expandHex(color);
  const monogram = BRANDING_COPY.preview.senderName.charAt(0);

  return (
    <div className={cn('flex flex-col gap-sm', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground-muted">
          {BRANDING_COPY.preview.label}
        </span>
        <span className="text-xs text-foreground-subtle">{BRANDING_COPY.preview.note}</span>
      </div>

      {/* The re-skin scope: brandStyle() sets the --brand-* hook; the font class
          sets the family. transition-colors animates the swatch/accent change. */}
      <div
        style={brandStyle(validColor)}
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-surface shadow-sm',
          'transition-colors duration-base ease-standard',
          fontClassName(font),
        )}
      >
        {/* Signer header */}
        <div className="flex items-center gap-sm border-b border-border p-md">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- runtime sender logo, arbitrary host
            <img
              src={logoUrl}
              alt={BRANDING_COPY.logo.thumbAlt}
              className="h-10 w-10 rounded-md object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-subtle text-md font-bold text-primary transition-colors duration-base ease-standard"
            >
              {monogram}
            </span>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-bold text-foreground">
              {BRANDING_COPY.preview.senderName}
            </span>
            <span className="text-xs text-foreground-subtle">{BRANDING_COPY.preview.caption}</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-md p-md">
          <div className="flex flex-col gap-2xs">
            <h3 className="text-md font-bold text-foreground">{BRANDING_COPY.preview.docTitle}</h3>
            <p className="text-sm text-foreground-muted">{BRANDING_COPY.preview.body}</p>
          </div>

          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={cn(
              'inline-flex h-11 items-center justify-center rounded-md px-lg text-base font-semibold',
              'bg-primary text-primary-foreground',
              'transition-colors duration-fast ease-standard',
            )}
          >
            {BRANDING_COPY.preview.primaryCta}
          </button>

          <span
            aria-hidden="true"
            className="text-sm font-semibold text-primary underline-offset-2 transition-colors duration-fast ease-standard"
          >
            {BRANDING_COPY.preview.link}
          </span>
        </div>
      </div>
    </div>
  );
}
