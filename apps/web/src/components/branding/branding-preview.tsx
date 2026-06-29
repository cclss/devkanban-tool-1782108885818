'use client';

/**
 * BrandingPreview — a live, faithful sample of the signer screen.
 *
 * Reuses the real {@link BrandingHeader} plus a representative slice of signer
 * chrome (heading, body, primary CTA, accent link) on the white signer surface.
 * The whole sample is wrapped in `brandStyle(color, font)`, so the brand color
 * re-skins every primary element through the `--brand-*` hook and the brand font
 * applies via `--brand-font` — exactly as the signer will see after grain-4
 * wires the same vars onto the real screens. Updates instantly as the admin
 * edits color / font / logo (no save required).
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { BrandingHeader } from '@/components/signer/branding-header';
import {
  BRANDING_COPY,
  brandStyle,
  ensureBrandFontLoaded,
  resolveLogoSrc,
} from '@/lib/branding';

const P = BRANDING_COPY.preview;

export function BrandingPreview({
  brandColor,
  brandFont,
  logoUrl,
  senderName,
}: {
  brandColor: string | null;
  brandFont: string;
  logoUrl: string | null;
  senderName: string | null;
}) {
  // Load the chosen font so the sample renders in it.
  React.useEffect(() => {
    ensureBrandFontLoaded(brandFont);
  }, [brandFont]);

  const sender = {
    name: senderName,
    brandColor,
    brandLogoUrl: resolveLogoSrc(logoUrl),
  };

  return (
    <div className="flex flex-col gap-xs">
      <span className="text-sm font-semibold text-foreground-muted">{P.label}</span>

      {/* A light device frame so the white signer surface reads as "their screen". */}
      <div className="rounded-lg border border-border bg-background p-md">
        <div
          // Brand color + font are scoped to this subtree only.
          style={{ ...brandStyle(brandColor, brandFont), fontFamily: 'var(--brand-font)' }}
          className="mx-auto flex w-full max-w-[360px] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm"
        >
          <div className="border-b border-border px-md py-sm">
            <BrandingHeader sender={sender} />
          </div>

          <div className="flex flex-col gap-sm px-md py-lg">
            <h3 className="text-md font-bold text-foreground">{P.sampleHeading}</h3>
            <p className="text-sm text-foreground-subtle">{P.sampleBody}</p>
            <Button type="button" size="md" fullWidth className="mt-2xs" tabIndex={-1}>
              {P.sampleCta}
            </Button>
            <span className="mt-2xs text-center text-sm font-semibold text-primary">
              {P.sampleLink}
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-foreground-subtle">{P.hint}</p>
    </div>
  );
}
