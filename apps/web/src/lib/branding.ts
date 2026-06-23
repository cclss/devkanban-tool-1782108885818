/**
 * Sender branding → CSS custom property bridge.
 *
 * The design system exposes a single override point, `--brand-primary` (and its
 * companions), from which every primary-colored token inherits (see the
 * `--brand-*` hook in `globals.css`). A sender stores one brand color; here we
 * expand it into the full companion set so an entire signer subtree re-skins by
 * setting these vars on one wrapping element — no component code is touched.
 *
 * The hover / pressed / subtle companions are derived from the base color with
 * `color-mix` so they stay in proportion to whatever hue the sender picked,
 * mirroring the relationship the default tokens have in `globals.css`.
 */

import type * as React from 'react';

/** CSS custom properties are not in the typed `CSSProperties` surface. */
type BrandStyle = React.CSSProperties & Record<`--${string}`, string>;

/** Accepts `#rgb` / `#rrggbb` only; anything else is ignored (sender-supplied). */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Build the inline style that re-skins the brand hook to `brandColor`. Returns
 * an empty object when there's no (valid) brand color, so the default tokens
 * remain in force.
 */
export function brandStyle(brandColor: string | null | undefined): BrandStyle {
  if (!brandColor || !HEX_COLOR.test(brandColor.trim())) return {};
  const base = brandColor.trim();
  return {
    '--brand-primary': base,
    // Darken for the hover/pressed states; lighten for the subtle wash. Ratios
    // echo the default ramp's spacing between primary and its companions.
    '--brand-primary-hover': `color-mix(in srgb, ${base} 88%, #000)`,
    '--brand-primary-pressed': `color-mix(in srgb, ${base} 76%, #000)`,
    '--brand-primary-subtle': `color-mix(in srgb, ${base} 12%, #fff)`,
  };
}
