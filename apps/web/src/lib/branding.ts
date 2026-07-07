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
 * True when `value` is a `#rgb` / `#rrggbb` hex color (after trimming). This is
 * the single validity gate for a brand color — `brandStyle()` and the brand
 * color picker both defer to it so the accepted shape is defined in one place.
 */
export function isValidHex(value: string | null | undefined): boolean {
  return !!value && HEX_COLOR.test(value.trim());
}

/**
 * Expand a `#rgb` shorthand to full `#rrggbb` (lowercased). A native color
 * input only accepts 7-char `#rrggbb`, so the picker's swatch feeds a value
 * through here first. Already-6-digit or non-hex input is just lowercased and
 * returned — callers guard shape with `isValidHex()`.
 */
export function expandHex(hex: string): string {
  const value = hex.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) {
    const [, r, g, b] = short;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return value;
}

/**
 * Build the inline style that re-skins the brand hook to `brandColor`. Returns
 * an empty object when there's no (valid) brand color, so the default tokens
 * remain in force.
 */
export function brandStyle(brandColor: string | null | undefined): BrandStyle {
  if (!isValidHex(brandColor)) return {};
  const base = brandColor!.trim();
  return {
    '--brand-primary': base,
    // Darken for the hover/pressed states; lighten for the subtle wash. Ratios
    // echo the default ramp's spacing between primary and its companions.
    '--brand-primary-hover': `color-mix(in srgb, ${base} 88%, #000)`,
    '--brand-primary-pressed': `color-mix(in srgb, ${base} 76%, #000)`,
    '--brand-primary-subtle': `color-mix(in srgb, ${base} 12%, #fff)`,
  };
}
