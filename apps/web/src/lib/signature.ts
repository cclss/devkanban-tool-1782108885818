/**
 * Pure, DOM-free signature helpers.
 *
 * Two concerns live here, both kept free of any canvas/DOM dependency so they
 * are trivially unit-testable in the `node` jest environment:
 *
 *   • The **pressure model** — a variable ink width that is INVERSELY
 *     proportional to pointer speed (a fast flick draws thin, a slow drag draws
 *     thick), plus the speed/distance/midpoint geometry the pad feeds it and a
 *     low-pass smoother that removes per-segment jitter.
 *   • The **typed-signature font set** — the three font-family stacks offered
 *     when a signer types their name instead of drawing it. This mirrors the
 *     typography tokens declared in `tailwind.config.ts` (the canonical source);
 *     it is duplicated here because the canvas rasterizer needs the literal
 *     family string for `ctx.font`, which cannot read a CSS variable.
 *
 * The actual ink color and the font CSS values are design tokens; the component
 * resolves the ink color from `--color-foreground` at draw time and renders chip
 * previews via these family stacks, so no raw color is hardcoded.
 */

/** A timestamped pointer sample in CSS pixels relative to the pad. */
export interface InkPoint {
  x: number;
  y: number;
  /** Event timestamp in ms (e.g. `event.timeStamp` / `performance.now()`). */
  t: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Euclidean distance between two points (px). */
export function distance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Midpoint of two points — the quadratic-curve join used to smooth the path. */
export function midpoint(a: InkPoint, b: InkPoint): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Pointer speed in px/ms between two timestamped samples. With no elapsed time
 * (same or out-of-order timestamp) the move is treated as instantaneous, i.e.
 * infinitely fast — which the width model maps to the thinnest line.
 */
export function speed(a: InkPoint, b: InkPoint): number {
  const dt = b.t - a.t;
  if (dt <= 0) return Number.POSITIVE_INFINITY;
  return distance(a, b) / dt;
}

export interface StrokeWidthOptions {
  /** Thinnest line — reached at/above `fastSpeed` (a quick flick). */
  minWidth: number;
  /** Thickest line — reached at/below `slowSpeed` (a slow, deliberate drag). */
  maxWidth: number;
  /** Speed (px/ms) at/below which the line is thickest. */
  slowSpeed: number;
  /** Speed (px/ms) at/above which the line is thinnest. */
  fastSpeed: number;
}

/**
 * Tuned for a finger/stylus on a fit-width mobile pad. Widths are CSS px applied
 * to the 2D context; the band (≈1.1–4.2px) reads as a natural ballpoint ink.
 */
export const DEFAULT_STROKE_WIDTH: StrokeWidthOptions = {
  minWidth: 1.1,
  maxWidth: 4.2,
  slowSpeed: 0.05,
  fastSpeed: 1.4,
};

/**
 * Map a pointer speed to an ink width that is inversely proportional to speed:
 * thick when slow, thin when fast. Linearly interpolated between `slowSpeed`
 * (→ `maxWidth`) and `fastSpeed` (→ `minWidth`) and clamped flat outside that
 * band, so the result always stays within `[minWidth, maxWidth]`.
 */
export function strokeWidthForSpeed(
  pointerSpeed: number,
  opts: StrokeWidthOptions = DEFAULT_STROKE_WIDTH,
): number {
  const { minWidth, maxWidth, slowSpeed, fastSpeed } = opts;
  // Degenerate/!ordered config → fall back to the thickest, deterministic value.
  if (!(fastSpeed > slowSpeed)) return maxWidth;
  if (Number.isNaN(pointerSpeed)) return maxWidth;
  const s = clamp(pointerSpeed, slowSpeed, fastSpeed);
  const t = (s - slowSpeed) / (fastSpeed - slowSpeed); // 0 (slow) … 1 (fast)
  return maxWidth + (minWidth - maxWidth) * t; // maxWidth → minWidth
}

/**
 * Low-pass the width toward `target` so it eases instead of snapping per
 * segment — this is what removes the visible jitter raw speed would produce.
 * `smoothing` is the inertia in [0, 0.95]: 0 uses the target directly, higher
 * values lag more. Clamped so a bad caller can't freeze the width.
 */
export function smoothWidth(prev: number, target: number, smoothing = 0.5): number {
  const s = clamp(smoothing, 0, 0.95);
  return prev * s + target * (1 - s);
}

/** A selectable typed-signature font. */
export interface SignatureFont {
  id: 'script' | 'serif' | 'sans';
  /** Short Korean chip label. */
  label: string;
  /**
   * CSS font-family stack. Mirrors the `tailwind.config.ts` fontFamily tokens
   * (`script` / `serif` / `sans`); used both for the live DOM preview (inline
   * style) and for the canvas `ctx.font` at rasterization time.
   */
  fontFamily: string;
}

/**
 * The three typed-signature fonts: a Korean-capable handwriting script, a
 * serif (명조), and the app's sans (고딕, Pretendard). Order is the chip order.
 */
export const SIGNATURE_FONTS: readonly SignatureFont[] = [
  { id: 'script', label: '손글씨', fontFamily: "'Nanum Pen Script', cursive" },
  { id: 'serif', label: '명조', fontFamily: "'Nanum Myeongjo', serif" },
  {
    id: 'sans',
    label: '고딕',
    fontFamily:
      "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  },
] as const;

export const DEFAULT_SIGNATURE_FONT: SignatureFont = SIGNATURE_FONTS[0]!;
