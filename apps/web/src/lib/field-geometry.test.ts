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
  resizeProportionalPx,
  scalePxRectAroundCenter,
  scaleNormRectAroundCenter,
  pointerDistance,
  snapMove,
  FIELD_TYPE_META,
  MIN_NORM_WIDTH,
  MIN_NORM_HEIGHT,
  type PageSize,
  type PxRect,
  type NormRect,
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

// --- Mobile / tablet touch-review gestures -----------------------------------
//
// These pin the direct-manipulation math the "확인" review surface composes
// (mobile-fields-review.tsx): proportional corner resize, two-finger pinch, the
// size stepper, and — most importantly for the grain — that every gesture stays
// inside the page raster after the shared clamp. The component drives only the
// React/pointer plumbing on top of these pure helpers, so the geometry is
// verified here in the node env (no jsdom), matching the repo's headless seam.

describe('resizeProportionalPx (touch corner handles)', () => {
  const base: PxRect = { left: 100, top: 100, width: 200, height: 100 }; // 2:1

  it('se corner scales width+height together, keeping aspect, pinning top-left', () => {
    // Drag the SE corner out by +100px in x. The longer growth axis (x) drives a
    // uniform scale, so height grows proportionally too (aspect ratio held).
    const r = resizeProportionalPx(base, 'se', 100, 0);
    expect(r.left).toBe(100);
    expect(r.top).toBe(100);
    expect(r.width / r.height).toBeCloseTo(2, 6); // 2:1 preserved
    expect(r.width).toBeGreaterThan(base.width);
    expect(r.height).toBeGreaterThan(base.height);
  });

  it('nw corner scales proportionally and pins the bottom-right corner', () => {
    const r = resizeProportionalPx(base, 'nw', -50, 0); // drag NW outward (left)
    expect(r.width / r.height).toBeCloseTo(2, 6);
    // Opposite (SE) corner held fixed.
    expect(r.left + r.width).toBeCloseTo(base.left + base.width, 6);
    expect(r.top + r.height).toBeCloseTo(base.top + base.height, 6);
  });

  it('never collapses below a 1% floor on a fully inward drag', () => {
    // Dragging far past the opposite edge can only shrink to the 0.01 scale floor.
    const r = resizeProportionalPx(base, 'se', -10000, -10000);
    expect(r.width).toBeCloseTo(base.width * 0.01, 6);
    expect(r.height).toBeCloseTo(base.height * 0.01, 6);
  });
});

describe('scalePxRectAroundCenter (pinch) + clamp', () => {
  const A4: PageSize = { width: 595, height: 842 };

  it('scales about the center, holding the center point still', () => {
    const rect: PxRect = { left: 200, top: 300, width: 100, height: 80 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const scaled = scalePxRectAroundCenter(rect, 1.5);
    expect(scaled.width).toBeCloseTo(150, 6);
    expect(scaled.height).toBeCloseTo(120, 6);
    expect(scaled.left + scaled.width / 2).toBeCloseTo(cx, 6);
    expect(scaled.top + scaled.height / 2).toBeCloseTo(cy, 6);
  });

  it('a pinch that overflows the page is clamped back inside (boundary)', () => {
    const rect: PxRect = { left: 40, top: 40, width: 400, height: 600 };
    const blownUp = clampPxRect(scalePxRectAroundCenter(rect, 4), A4);
    expect(blownUp.left).toBeGreaterThanOrEqual(0);
    expect(blownUp.top).toBeGreaterThanOrEqual(0);
    expect(blownUp.left + blownUp.width).toBeLessThanOrEqual(A4.width + 1e-9);
    expect(blownUp.top + blownUp.height).toBeLessThanOrEqual(A4.height + 1e-9);
  });
});

describe('scaleNormRectAroundCenter (size stepper) + clamp', () => {
  it('grow/shrink scale about the center in normalized space', () => {
    const rect: NormRect = { x: 0.4, y: 0.4, width: 0.2, height: 0.1 };
    const cx = rect.x + rect.width / 2;
    const grown = scaleNormRectAroundCenter(rect, 1.12);
    expect(grown.width).toBeCloseTo(0.2 * 1.12, 9);
    expect(grown.x + grown.width / 2).toBeCloseTo(cx, 9);

    const shrunk = scaleNormRectAroundCenter(rect, 0.89);
    expect(shrunk.width).toBeCloseTo(0.2 * 0.89, 9);
  });

  it('growing a near-edge field clamps to a server-valid in-page box', () => {
    const rect: NormRect = { x: 0.85, y: 0.05, width: 0.2, height: 0.1 };
    const c = clampNormRect(scaleNormRectAroundCenter(rect, 1.12));
    for (const v of [c.x, c.y, c.width, c.height]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(c.x + c.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('shrinking can never go below the minimum field size', () => {
    const rect: NormRect = { x: 0.5, y: 0.5, width: MIN_NORM_WIDTH, height: MIN_NORM_HEIGHT };
    const c = clampNormRect(scaleNormRectAroundCenter(rect, 0.5));
    expect(c.width).toBeCloseTo(MIN_NORM_WIDTH, 9);
    expect(c.height).toBeCloseTo(MIN_NORM_HEIGHT, 9);
  });
});

describe('pointerDistance (pinch tracking)', () => {
  it('measures the gap between the two tracked pointers', () => {
    const pts = new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 3, y: 4 }],
    ]);
    expect(pointerDistance(pts)).toBeCloseTo(5, 9);
  });

  it('returns 0 when fewer than two pointers are down', () => {
    expect(pointerDistance(new Map([[1, { x: 10, y: 10 }]]))).toBe(0);
    expect(pointerDistance(new Map())).toBe(0);
  });
});

describe('drag-move pipeline: stays in-page after the page-edge clamp', () => {
  // Mirrors the touch surface's move gesture: shift the start rect by the finger
  // delta, clamp to the raster, snap to guides, clamp again, then normalize +
  // clamp on commit. The whole chain must keep the box inside the page no matter
  // how far the finger travels past an edge — the grain's boundary-clamp guard.
  const A4: PageSize = { width: 595, height: 842 };

  function dragCommit(start: PxRect, dx: number, dy: number): NormRect {
    const moved = clampPxRect({ ...start, left: start.left + dx, top: start.top + dy }, A4);
    const snapped = snapMove(moved, A4, [], 8);
    const final = clampPxRect(snapped.rect, A4);
    return clampNormRect(pxToNorm(final, A4));
  }

  it('a drag far past the bottom-right corner settles flush inside the page', () => {
    const start: PxRect = { left: 400, top: 600, width: 150, height: 80 };
    const committed = dragCommit(start, 9999, 9999);
    expect(committed.x).toBeGreaterThanOrEqual(0);
    expect(committed.y).toBeGreaterThanOrEqual(0);
    expect(committed.x + committed.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(committed.y + committed.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('a drag far past the top-left corner pins the box to the origin edges', () => {
    const start: PxRect = { left: 120, top: 200, width: 150, height: 80 };
    const committed = dragCommit(start, -9999, -9999);
    // Pinned to the left edge (x≈0) and the page top (norm y = 1 − height).
    expect(committed.x).toBeCloseTo(0, 6);
    expect(committed.y + committed.height).toBeCloseTo(1, 6);
    // Size is preserved by the move (no resize), modulo float.
    expect(committed.width).toBeCloseTo(150 / A4.width, 6);
    expect(committed.height).toBeCloseTo(80 / A4.height, 6);
  });

  it('a small in-bounds drag just translates the box by the delta', () => {
    const start: PxRect = { left: 100, top: 100, width: 120, height: 60 };
    const committed = dragCommit(start, 30, -20);
    // No clamping engaged → the normalized round-trip reproduces left/top exactly.
    const back = normToPx(committed, A4);
    expect(back.left).toBeCloseTo(130, 4);
    expect(back.top).toBeCloseTo(80, 4);
  });
});
