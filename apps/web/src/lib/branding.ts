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
 *
 * Typography has its own single override point, `--brand-font` (see the
 * `--brand-font` hook in `globals.css`): `brandFontStyle` re-skins it the same
 * way `brandStyle` re-skins the color hook, so the same wrapping element carries
 * both and the whole signer subtree inherits the sender's chosen family.
 */

import type * as React from 'react';
import type { BrandFont } from './branding-settings';

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

/**
 * BrandFont identifier → CSS font-family stack. Mirrors the Tailwind
 * `fontFamily` tokens (`sans`/`serif`/`script` in `tailwind.config.ts`) one for
 * one — this is a runtime *selector* over the existing typography families, not
 * a new visual value. Kept here (rather than imported) so the sender bridge has
 * no dependency on the admin-only catalog and the stacks read at a glance.
 */
const BRAND_FONT_STACK: Record<BrandFont, string> = {
  SANS: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
  SERIF: "'Nanum Myeongjo', serif",
  SCRIPT: "'Nanum Pen Script', cursive",
};

/**
 * Build the inline style that re-skins the brand font hook to `brandFont`,
 * homologous to {@link brandStyle}. Sets `--brand-font` (the override point) and
 * binds `font-family` to it, so every text node in the wrapped subtree inherits
 * the chosen family. Returns an empty object for a missing/unknown font, so the
 * default `--brand-font` (the sans stack) stays in force — a safe fallback for a
 * sender who hasn't chosen one or a value the client doesn't recognize.
 */
export function brandFontStyle(brandFont: string | null | undefined): BrandStyle {
  const stack = brandFont ? BRAND_FONT_STACK[brandFont as BrandFont] : undefined;
  if (!stack) return {};
  return {
    '--brand-font': stack,
    fontFamily: 'var(--brand-font)',
  };
}
