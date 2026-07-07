/**
 * Brand color helper unit tests.
 *
 * Pins the rules the 대표 색상 color picker rests on — the single validity gate
 * and the swatch-format adapter both live in `lib/branding`, so the picker
 * never redefines HEX handling:
 *   • isValidHex — which `#rgb` / `#rrggbb` values pass (and what's rejected),
 *   • expandHex — `#rgb` shorthand → `#rrggbb` for the native color input,
 *   • brandStyle — a valid color fills the `--brand-*` hook; invalid clears it.
 *
 * Runs in the `node` jest environment: all three are pure string functions, no
 * DOM needed.
 */

import { brandStyle, expandHex, isValidHex } from './branding';

describe('isValidHex', () => {
  it('accepts #rrggbb', () => {
    expect(isValidHex('#163AF2')).toBe(true);
    expect(isValidHex('#ffffff')).toBe(true);
  });

  it('accepts #rgb shorthand', () => {
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('#0F0')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isValidHex('  #1c64f2  ')).toBe(true);
  });

  it('rejects missing hash, wrong length, and non-hex digits', () => {
    expect(isValidHex('163AF2')).toBe(false); // no leading #
    expect(isValidHex('#12')).toBe(false); // too short
    expect(isValidHex('#12345')).toBe(false); // 5 digits
    expect(isValidHex('#1234567')).toBe(false); // 7 digits
    expect(isValidHex('#GGGGGG')).toBe(false); // non-hex
    expect(isValidHex('rgb(22,60,242)')).toBe(false); // wrong format
  });

  it('rejects empty / null / undefined', () => {
    expect(isValidHex('')).toBe(false);
    expect(isValidHex(null)).toBe(false);
    expect(isValidHex(undefined)).toBe(false);
  });
});

describe('expandHex', () => {
  it('expands #rgb shorthand to lowercased #rrggbb', () => {
    expect(expandHex('#abc')).toBe('#aabbcc');
    expect(expandHex('#0F0')).toBe('#00ff00');
  });

  it('lowercases and trims an already-6-digit value', () => {
    expect(expandHex('  #163AF2 ')).toBe('#163af2');
  });
});

describe('brandStyle', () => {
  it('fills the --brand-* hook from a valid color', () => {
    const style = brandStyle('#163AF2');
    expect(style['--brand-primary']).toBe('#163AF2');
    // Companions derive from the base via color-mix, so a single pick re-skins
    // hover / pressed / subtle together.
    expect(style['--brand-primary-hover']).toContain('#163AF2');
    expect(style['--brand-primary-pressed']).toContain('#163AF2');
    expect(style['--brand-primary-subtle']).toContain('#163AF2');
  });

  it('returns an empty style for an invalid or missing color', () => {
    expect(brandStyle('nope')).toEqual({});
    expect(brandStyle('')).toEqual({});
    expect(brandStyle(null)).toEqual({});
    expect(brandStyle(undefined)).toEqual({});
  });
});
