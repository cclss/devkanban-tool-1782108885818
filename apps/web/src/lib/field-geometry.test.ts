/**
 * Coordinate-transform unit tests.
 *
 * These pin the canvas↔PDF bridge that the whole placement step rests on:
 *   • round-trip fidelity (store → reload restores the identical box),
 *   • the bottom-left/top-left axis flip,
 *   • zoom invariance (same normalized field, any page pixel size),
 *   • in-page clamping, and the snap/resize helpers.
 */

import {
  pxToNorm,
  normToPx,
  clampNormRect,
  clampPxRect,
  defaultPxRectAt,
  resizePxRect,
  snapMove,
  rectsIntersect,
  rectFromPoints,
  marqueeHitTest,
  FIELD_TYPE_META,
  MIN_NORM_WIDTH,
  MIN_NORM_HEIGHT,
  type PageSize,
  type PxRect,
} from './field-geometry';

const A4: PageSize = { width: 595, height: 842 };

function expectRectClose(a: PxRect, b: PxRect, eps = 1e-6) {
  expect(Math.abs(a.left - b.left)).toBeLessThan(eps);
  expect(Math.abs(a.top - b.top)).toBeLessThan(eps);
  expect(Math.abs(a.width - b.width)).toBeLessThan(eps);
  expect(Math.abs(a.height - b.height)).toBeLessThan(eps);
}

describe('pxToNorm / normToPx', () => {
  it('round-trips px → norm → px for arbitrary rects (store/reload identity)', () => {
    const rects: PxRect[] = [
      { left: 0, top: 0, width: 100, height: 40 },
      { left: 120, top: 300, width: 220, height: 64 },
      { left: 595 - 80, top: 842 - 50, width: 80, height: 50 },
      { left: 37.5, top: 411.2, width: 153.9, height: 28.4 },
    ];
    for (const r of rects) {
      const back = normToPx(pxToNorm(r, A4), A4);
      expectRectClose(back, r);
    }
  });

  it('round-trips norm → px → norm', () => {
    const norm = { x: 0.2, y: 0.65, width: 0.3, height: 0.08 };
    const back = pxToNorm(normToPx(norm, A4), A4);
    expect(back.x).toBeCloseTo(norm.x, 9);
    expect(back.y).toBeCloseTo(norm.y, 9);
    expect(back.width).toBeCloseTo(norm.width, 9);
    expect(back.height).toBeCloseTo(norm.height, 9);
  });

  it('flips the Y axis: a box at the canvas top maps to a high PDF y', () => {
    const topBox: PxRect = { left: 0, top: 0, width: 100, height: 100 };
    const n = pxToNorm(topBox, A4);
    // Bottom edge of a top-aligned box is height/pageHeight from the page top,
    // so its lower-left y (from the bottom) is 1 - height/pageHeight.
    expect(n.y).toBeCloseTo(1 - 100 / 842, 9);

    const bottomBox: PxRect = { left: 0, top: 842 - 100, width: 100, height: 100 };
    expect(pxToNorm(bottomBox, A4).y).toBeCloseTo(0, 9);
  });

  it('is zoom invariant: same normalized field renders proportionally at any size', () => {
    const norm = { x: 0.25, y: 0.5, width: 0.4, height: 0.1 };
    const small: PageSize = { width: 297.5, height: 421 }; // 0.5x
    const large: PageSize = { width: 1190, height: 1684 }; // 2x

    const pSmall = normToPx(norm, small);
    const pLarge = normToPx(norm, large);

    // Every coordinate scales by exactly the page-size ratio (4x here).
    expect(pLarge.left / pSmall.left).toBeCloseTo(4, 6);
    expect(pLarge.top / pSmall.top).toBeCloseTo(4, 6);
    expect(pLarge.width / pSmall.width).toBeCloseTo(4, 6);
    expect(pLarge.height / pSmall.height).toBeCloseTo(4, 6);

    // And both still normalize back to the original field.
    expect(pxToNorm(pSmall, small).x).toBeCloseTo(norm.x, 9);
    expect(pxToNorm(pLarge, large).y).toBeCloseTo(norm.y, 9);
  });
});

describe('clampNormRect', () => {
  it('keeps an over-large field inside the page', () => {
    const c = clampNormRect({ x: 0.8, y: 0.9, width: 0.5, height: 0.4 });
    expect(c.x + c.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });

  it('enforces the minimum field size', () => {
    const c = clampNormRect({ x: 0.1, y: 0.1, width: 0.001, height: 0.001 });
    expect(c.width).toBeCloseTo(MIN_NORM_WIDTH, 9);
    expect(c.height).toBeCloseTo(MIN_NORM_HEIGHT, 9);
  });

  it('produces server-valid coords (every field stays within 0..1)', () => {
    const c = clampNormRect({ x: -0.2, y: -0.5, width: 2, height: 2 });
    for (const v of [c.x, c.y, c.width, c.height]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(c.x + c.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.height).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('clampPxRect', () => {
  it('pulls an out-of-bounds box back inside the raster', () => {
    const c = clampPxRect({ left: -50, top: -20, width: 100, height: 60 }, A4);
    expect(c.left).toBe(0);
    expect(c.top).toBe(0);
    const c2 = clampPxRect({ left: 560, top: 820, width: 100, height: 100 }, A4);
    expect(c2.left + c2.width).toBeLessThanOrEqual(A4.width + 1e-9);
    expect(c2.top + c2.height).toBeLessThanOrEqual(A4.height + 1e-9);
  });
});

describe('defaultPxRectAt', () => {
  it('centers a default-sized field on the drop point', () => {
    const r = defaultPxRectAt('SIGNATURE', { x: 300, y: 400 }, A4);
    expect(r.left + r.width / 2).toBeCloseTo(300, 6);
    expect(r.top + r.height / 2).toBeCloseTo(400, 6);
    expect(r.width).toBeCloseTo(FIELD_TYPE_META.SIGNATURE.defaultSize.width * A4.width, 6);
  });

  it('clamps when dropped near an edge', () => {
    const r = defaultPxRectAt('TEXT', { x: 5, y: 5 }, A4);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
  });
});

describe('resizePxRect', () => {
  const base: PxRect = { left: 100, top: 100, width: 200, height: 100 };

  it('se handle grows width/height, pins top-left', () => {
    const r = resizePxRect(base, 'se', 40, 30);
    expect(r.left).toBe(100);
    expect(r.top).toBe(100);
    expect(r.width).toBe(240);
    expect(r.height).toBe(130);
  });

  it('nw handle moves origin, pins bottom-right', () => {
    const r = resizePxRect(base, 'nw', 20, 10);
    expect(r.left).toBe(120);
    expect(r.top).toBe(110);
    expect(r.left + r.width).toBe(300); // right edge unchanged
    expect(r.top + r.height).toBe(200); // bottom edge unchanged
  });

  it('e handle only affects width', () => {
    const r = resizePxRect(base, 'e', 50, 999);
    expect(r.width).toBe(250);
    expect(r.height).toBe(100);
    expect(r.top).toBe(100);
  });
});

describe('snapMove', () => {
  it('snaps a near-centered field to the page center line', () => {
    const page: PageSize = { width: 600, height: 800 };
    // Field center x would be 302 → 2px from page center (300), within threshold.
    const rect: PxRect = { left: 202, top: 100, width: 200, height: 80 };
    const { rect: snapped, guides } = snapMove(rect, page, [], 6);
    expect(snapped.left + snapped.width / 2).toBeCloseTo(300, 6);
    expect(guides.some((g) => g.axis === 'x' && Math.abs(g.pos - 300) < 1e-6)).toBe(true);
  });

  it('leaves a field alone when no guide is within threshold', () => {
    const page: PageSize = { width: 600, height: 800 };
    const rect: PxRect = { left: 137, top: 211, width: 90, height: 40 };
    const { rect: snapped, guides } = snapMove(rect, page, [], 4);
    expect(snapped.left).toBe(137);
    expect(snapped.top).toBe(211);
    expect(guides.length).toBe(0);
  });

  it('snaps a left edge to a peer field left edge', () => {
    const page: PageSize = { width: 600, height: 800 };
    const peer: PxRect = { left: 150, top: 400, width: 100, height: 50 };
    const rect: PxRect = { left: 153, top: 100, width: 80, height: 40 };
    const { rect: snapped } = snapMove(rect, page, [peer], 6);
    expect(snapped.left).toBeCloseTo(150, 6);
  });
});

describe('rectsIntersect', () => {
  const base: PxRect = { left: 100, top: 100, width: 100, height: 100 };

  it('detects overlapping rects', () => {
    expect(rectsIntersect(base, { left: 150, top: 150, width: 100, height: 100 })).toBe(true);
  });

  it('detects containment (one fully inside the other)', () => {
    expect(rectsIntersect(base, { left: 120, top: 120, width: 20, height: 20 })).toBe(true);
    expect(rectsIntersect({ left: 120, top: 120, width: 20, height: 20 }, base)).toBe(true);
  });

  it('rejects fully separated rects', () => {
    expect(rectsIntersect(base, { left: 250, top: 100, width: 40, height: 40 })).toBe(false);
    expect(rectsIntersect(base, { left: 100, top: 250, width: 40, height: 40 })).toBe(false);
  });

  it('treats edge-only contact (zero overlap area) as non-intersecting', () => {
    // right edge of base (x=200) touches left edge of the other — no area shared.
    expect(rectsIntersect(base, { left: 200, top: 100, width: 40, height: 40 })).toBe(false);
  });

  it('a zero-size rect (a click) intersects nothing', () => {
    expect(rectsIntersect({ left: 150, top: 150, width: 0, height: 0 }, base)).toBe(false);
  });
});

describe('rectFromPoints', () => {
  it('builds a positive-size rect regardless of drag direction', () => {
    const forward = rectFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 });
    expect(forward).toEqual({ left: 10, top: 20, width: 50, height: 70 });

    // Dragging up-left from the anchor yields the same box.
    const backward = rectFromPoints({ x: 60, y: 90 }, { x: 10, y: 20 });
    expect(backward).toEqual({ left: 10, top: 20, width: 50, height: 70 });
  });
});

describe('marqueeHitTest', () => {
  const items = [
    { id: 'a', rect: { left: 0, top: 0, width: 50, height: 50 } },
    { id: 'b', rect: { left: 100, top: 100, width: 50, height: 50 } },
    { id: 'c', rect: { left: 300, top: 300, width: 50, height: 50 } },
  ];

  it('returns ids of every field the marquee crosses', () => {
    const hits = marqueeHitTest({ left: 20, top: 20, width: 110, height: 110 }, items);
    expect(hits).toEqual(['a', 'b']);
  });

  it('returns empty when the marquee touches nothing', () => {
    expect(marqueeHitTest({ left: 200, top: 0, width: 40, height: 40 }, items)).toEqual([]);
  });

  it('includes a field the marquee fully encloses', () => {
    const hits = marqueeHitTest({ left: 90, top: 90, width: 80, height: 80 }, items);
    expect(hits).toEqual(['b']);
  });
});
