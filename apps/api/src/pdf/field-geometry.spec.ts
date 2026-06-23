import {
  localToPage,
  normalizeRotation,
  resolveFieldPlacement,
  type NormRect,
  type PageSize,
} from './field-geometry';

/**
 * Web-side `pxToNorm` (apps/web/src/lib/field-geometry.ts), reproduced here so
 * the test asserts the *full* round trip a real field takes: a canvas rect
 * (top-left origin px) → normalized store shape → PDF media-box placement.
 */
function pxToNorm(
  rect: { left: number; top: number; width: number; height: number },
  page: PageSize,
): NormRect {
  return {
    x: rect.left / page.width,
    y: (page.height - (rect.top + rect.height)) / page.height,
    width: rect.width / page.width,
    height: rect.height / page.height,
  };
}

describe('normalizeRotation', () => {
  it('passes through the four canonical right angles', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it('wraps negatives and values ≥ 360', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it('snaps odd angles to the nearest right angle', () => {
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(46)).toBe(90);
    expect(normalizeRotation(269)).toBe(270);
  });
});

describe('resolveFieldPlacement — no rotation', () => {
  const page: PageSize = { width: 600, height: 800 };

  it('maps a normalized (bottom-left) rect straight to media-box points', () => {
    const field: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const p = resolveFieldPlacement(field, page, 0);
    expect(p).toEqual({ x: 60, y: 160, width: 180, height: 320, rotation: 0 });
  });

  it('flips top-left canvas px ↔ bottom-left PDF origin (full round trip)', () => {
    // A field whose TOP edge is 100px from the canvas top should sit so its
    // BOTTOM edge is at page.height - (100 + height) in PDF space.
    const pxRect = { left: 60, top: 100, width: 180, height: 240 };
    const field = pxToNorm(pxRect, page);
    const p = resolveFieldPlacement(field, page, 0);
    expect(p.x).toBeCloseTo(60, 6);
    expect(p.y).toBeCloseTo(800 - (100 + 240), 6); // 460
    expect(p.width).toBeCloseTo(180, 6);
    expect(p.height).toBeCloseTo(240, 6);
  });

  it('localToPage walks the box corners in an upright frame', () => {
    const field: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const p = resolveFieldPlacement(field, page, 0);
    expect(localToPage(p, 0, 0)).toEqual({ x: 60, y: 160 });
    expect(localToPage(p, p.width, 0)).toEqual({ x: 240, y: 160 });
    expect(localToPage(p, 0, p.height)).toEqual({ x: 60, y: 480 });
  });
});

describe('resolveFieldPlacement — rotated pages', () => {
  const page: PageSize = { width: 600, height: 800 };
  const field: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.25 };

  it('90° CW: swaps visible axes and counter-rotates', () => {
    const p = resolveFieldPlacement(field, page, 90);
    // visible size (800,600): Lx=80, Ly=120, dw=240, dh=150
    expect(p).toEqual({ x: 480, y: 80, width: 240, height: 150, rotation: 90 });
    expect(localToPage(p, 0, 0)).toEqual({ x: 480, y: 80 });
    expect(localToPage(p, p.width, 0)).toEqual({ x: 480, y: 320 }); // width → +y
    expect(localToPage(p, 0, p.height)).toEqual({ x: 330, y: 80 }); // height → -x
  });

  it('180°: mirrors both axes, dimensions unswapped', () => {
    const p = resolveFieldPlacement(field, page, 180);
    // visible size (600,800): Lx=60, Ly=160, dw=180, dh=200
    expect(p).toEqual({ x: 540, y: 640, width: 180, height: 200, rotation: 180 });
    expect(localToPage(p, p.width, 0)).toEqual({ x: 360, y: 640 });
    expect(localToPage(p, 0, p.height)).toEqual({ x: 540, y: 440 });
  });

  it('270° CW: swaps visible axes the other way', () => {
    const p = resolveFieldPlacement(field, page, 270);
    // visible size (800,600): Lx=80, Ly=120, dw=240, dh=150
    expect(p).toEqual({ x: 120, y: 720, width: 240, height: 150, rotation: 270 });
    expect(localToPage(p, p.width, 0)).toEqual({ x: 120, y: 480 });
    expect(localToPage(p, 0, p.height)).toEqual({ x: 270, y: 720 });
  });

  it('keeps the placed box fully inside the page for every rotation', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const p = resolveFieldPlacement(field, page, rot);
      // All four corners (via the upright local frame) land within the media box.
      const corners = [
        localToPage(p, 0, 0),
        localToPage(p, p.width, 0),
        localToPage(p, 0, p.height),
        localToPage(p, p.width, p.height),
      ];
      for (const c of corners) {
        expect(c.x).toBeGreaterThanOrEqual(-1e-6);
        expect(c.x).toBeLessThanOrEqual(page.width + 1e-6);
        expect(c.y).toBeGreaterThanOrEqual(-1e-6);
        expect(c.y).toBeLessThanOrEqual(page.height + 1e-6);
      }
    }
  });
});
