/**
 * Unit tests for the sender-branding → CSS-hook bridge.
 *
 * `brandScope` is the single source the four signer surfaces (and the portaled
 * signature sheet) use to re-skin to a sender's brand. These tests pin the
 * contract that matters at the boundary: color and font are *always* applied
 * together, and missing / plan-gated values fall back to the default tokens.
 *
 * The visual outcome (sheet primary button + focus ring in the brand color, sheet
 * text in the brand font) follows from the `globals.css` wiring —
 * `--color-primary`/`--color-ring`/`--color-focus` resolve from `--brand-primary`
 * and `font-family` from `--brand-font` — so asserting the hook vars here asserts
 * the rendered result. (jsdom/component rendering is out of this node-env runner.)
 */

import { brandScope, brandStyle, brandFontStyle } from './branding';
import type { BrandFont } from './branding-settings';

// A non-default brand: purple color + serif font (the Done-when example).
const PURPLE = '#7c3aed';
const sender = (
  over: Partial<{ brandColor: string | null; brandFont: BrandFont | null }> = {},
): { brandColor: string | null; brandFont: BrandFont | null } => ({
  brandColor: PURPLE,
  brandFont: 'SERIF',
  ...over,
});

describe('brandScope', () => {
  it('applies brand color and font together for a non-default sender', () => {
    const style = brandScope(sender());

    // Color hook (every primary-colored token — buttons, focus ring — inherits).
    expect(style['--brand-primary']).toBe(PURPLE);
    expect(style['--brand-primary-hover']).toContain(PURPLE);
    expect(style['--brand-primary-pressed']).toContain(PURPLE);
    expect(style['--brand-primary-subtle']).toContain(PURPLE);

    // Font hook (the wrapped subtree's text inherits the chosen family).
    expect(style['--brand-font']).toContain('Nanum Myeongjo');
    expect(style.fontFamily).toBe('var(--brand-font)');
  });

  it('is exactly the merge of brandStyle and brandFontStyle (one source of truth)', () => {
    const s = sender();
    expect(brandScope(s)).toEqual({
      ...brandStyle(s.brandColor),
      ...brandFontStyle(s.brandFont),
    });
  });

  it('falls back to default tokens for a null sender (plan-gated / missing)', () => {
    expect(brandScope(null)).toEqual({});
    expect(brandScope(undefined)).toEqual({});
  });

  it('falls back per-axis when only one of color/font is set', () => {
    const colorOnly = brandScope(sender({ brandFont: null }));
    expect(colorOnly['--brand-primary']).toBe(PURPLE);
    expect(colorOnly['--brand-font']).toBeUndefined();
    expect(colorOnly.fontFamily).toBeUndefined();

    const fontOnly = brandScope(sender({ brandColor: null }));
    expect(fontOnly['--brand-font']).toContain('Nanum Myeongjo');
    expect(fontOnly['--brand-primary']).toBeUndefined();
  });

  it('ignores an invalid brand color but keeps a valid font', () => {
    const style = brandScope(sender({ brandColor: 'not-a-hex', brandFont: 'SCRIPT' }));
    expect(style['--brand-primary']).toBeUndefined();
    expect(style['--brand-font']).toContain('Nanum Pen Script');
  });
});
