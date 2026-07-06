/**
 * Pressure-model unit tests.
 *
 * These pin the variable-ink behavior the signature pad rests on:
 *   • width is INVERSELY proportional to speed (fast flick → thin, slow → thick),
 *   • it clamps flat outside the speed band and never escapes [min, max],
 *   • degenerate input is deterministic, and
 *   • the speed/distance/midpoint/smoothing geometry the pad feeds it.
 */

import {
  distance,
  midpoint,
  speed,
  strokeWidthForSpeed,
  smoothWidth,
  DEFAULT_STROKE_WIDTH,
  SIGNATURE_FONTS,
  type InkPoint,
  type StrokeWidthOptions,
} from './signature';

const p = (x: number, y: number, t = 0): InkPoint => ({ x, y, t });

describe('distance / midpoint', () => {
  it('computes Euclidean distance', () => {
    expect(distance(p(0, 0), p(3, 4))).toBeCloseTo(5);
    expect(distance(p(1, 1), p(1, 1))).toBe(0);
  });

  it('computes the midpoint', () => {
    expect(midpoint(p(0, 0), p(4, 10))).toEqual({ x: 2, y: 5 });
  });
});

describe('speed', () => {
  it('is distance over elapsed time (px/ms)', () => {
    // 10px over 5ms = 2 px/ms
    expect(speed(p(0, 0, 0), p(10, 0, 5))).toBeCloseTo(2);
  });

  it('treats a zero / non-positive time gap as infinitely fast', () => {
    expect(speed(p(0, 0, 5), p(10, 0, 5))).toBe(Number.POSITIVE_INFINITY);
    expect(speed(p(0, 0, 10), p(10, 0, 5))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('strokeWidthForSpeed', () => {
  const { minWidth, maxWidth, slowSpeed, fastSpeed } = DEFAULT_STROKE_WIDTH;

  it('is thickest at/below the slow threshold', () => {
    expect(strokeWidthForSpeed(slowSpeed)).toBeCloseTo(maxWidth);
    expect(strokeWidthForSpeed(0)).toBeCloseTo(maxWidth);
    expect(strokeWidthForSpeed(-5)).toBeCloseTo(maxWidth); // clamped
  });

  it('is thinnest at/above the fast threshold', () => {
    expect(strokeWidthForSpeed(fastSpeed)).toBeCloseTo(minWidth);
    expect(strokeWidthForSpeed(fastSpeed * 10)).toBeCloseTo(minWidth);
    expect(strokeWidthForSpeed(Number.POSITIVE_INFINITY)).toBeCloseTo(minWidth);
  });

  it('decreases monotonically as speed rises (inverse relationship)', () => {
    const speeds = [0, 0.2, 0.5, 0.9, 1.4, 3];
    const widths = speeds.map((s) => strokeWidthForSpeed(s));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]!);
    }
  });

  it('sits at the midpoint width for the mid-band speed', () => {
    const mid = (slowSpeed + fastSpeed) / 2;
    expect(strokeWidthForSpeed(mid)).toBeCloseTo((minWidth + maxWidth) / 2);
  });

  it('never escapes [minWidth, maxWidth]', () => {
    for (const s of [-100, 0, 0.3, 0.7, 1, 5, 1000, Infinity]) {
      const w = strokeWidthForSpeed(s);
      expect(w).toBeGreaterThanOrEqual(minWidth - 1e-9);
      expect(w).toBeLessThanOrEqual(maxWidth + 1e-9);
    }
  });

  it('honors a custom width band', () => {
    const opts: StrokeWidthOptions = { minWidth: 2, maxWidth: 8, slowSpeed: 0, fastSpeed: 1 };
    expect(strokeWidthForSpeed(0, opts)).toBeCloseTo(8);
    expect(strokeWidthForSpeed(1, opts)).toBeCloseTo(2);
    expect(strokeWidthForSpeed(0.5, opts)).toBeCloseTo(5);
  });

  it('is deterministic for degenerate config (fast ≤ slow) and NaN', () => {
    const bad: StrokeWidthOptions = { minWidth: 1, maxWidth: 4, slowSpeed: 1, fastSpeed: 1 };
    expect(strokeWidthForSpeed(0.5, bad)).toBe(4);
    expect(strokeWidthForSpeed(NaN)).toBe(DEFAULT_STROKE_WIDTH.maxWidth);
  });
});

describe('smoothWidth', () => {
  it('returns the target when smoothing is 0', () => {
    expect(smoothWidth(1, 4, 0)).toBeCloseTo(4);
  });

  it('eases toward the target (stays between prev and target)', () => {
    const next = smoothWidth(1, 5, 0.5);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(5);
    expect(next).toBeCloseTo(3);
  });

  it('clamps smoothing so it cannot freeze the width', () => {
    const next = smoothWidth(1, 5, 5); // clamped to 0.95
    expect(next).toBeGreaterThan(1);
  });
});

describe('SIGNATURE_FONTS', () => {
  it('offers at least three distinct font families', () => {
    expect(SIGNATURE_FONTS.length).toBeGreaterThanOrEqual(3);
    const families = new Set(SIGNATURE_FONTS.map((f) => f.fontFamily));
    expect(families.size).toBe(SIGNATURE_FONTS.length);
  });
});
