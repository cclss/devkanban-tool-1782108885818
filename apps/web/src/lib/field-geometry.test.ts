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
  alignNormRects,
  distributeNormRects,
  offsetNormRects,
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

describe('alignNormRects', () => {
  // A spread-out selection whose bounding box edges are all distinct, so each
  // mode's target line is unambiguous:
  //   left edges:   0.10, 0.30, 0.60   → minLeft   = 0.10
  //   right edges:  0.30, 0.50, 0.80   → maxRight  = 0.80
  //   bottom edges: 0.20, 0.50, 0.70   → minBottom = 0.20
  //   top edges:    0.30, 0.70, 0.85   → maxTop    = 0.85
  const sel: NormRect[] = [
    { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
    { x: 0.3, y: 0.5, width: 0.2, height: 0.2 },
    { x: 0.6, y: 0.7, width: 0.2, height: 0.15 },
  ];

  it('left: pins every left edge to the bounding box left', () => {
    const out = alignNormRects(sel, 'left');
    for (const r of out) expect(r.x).toBeCloseTo(0.1, 9);
  });

  it('right: pins every right edge to the bounding box right', () => {
    const out = alignNormRects(sel, 'right');
    for (const r of out) expect(r.x + r.width).toBeCloseTo(0.8, 9);
  });

  it('hcenter: shares the bounding box vertical center-line', () => {
    const out = alignNormRects(sel, 'hcenter');
    const center = (0.1 + 0.8) / 2; // 0.45
    for (const r of out) expect(r.x + r.width / 2).toBeCloseTo(center, 9);
  });

  it('bottom: pins every bottom edge to the bounding box bottom', () => {
    const out = alignNormRects(sel, 'bottom');
    for (const r of out) expect(r.y).toBeCloseTo(0.2, 9);
  });

  it('top: pins every top edge (y+height) to the bounding box top (y-flip aware)', () => {
    const out = alignNormRects(sel, 'top');
    for (const r of out) expect(r.y + r.height).toBeCloseTo(0.85, 9);
  });

  it('vcenter: shares the bounding box horizontal center-line', () => {
    const out = alignNormRects(sel, 'vcenter');
    const center = (0.2 + 0.85) / 2; // 0.525
    for (const r of out) expect(r.y + r.height / 2).toBeCloseTo(center, 9);
  });

  it('takes the bounding box (not the last-picked field) as the reference', () => {
    // Last field's left edge is 0.60; a last-field reference would pin to 0.60.
    // Bounding-box reference pins to the leftmost edge, 0.10.
    const out = alignNormRects(sel, 'left');
    expect(out.every((r) => Math.abs(r.x - 0.6) < 1e-9)).toBe(false);
    for (const r of out) expect(r.x).toBeCloseTo(0.1, 9);
  });

  it('moves only the aligned axis, preserving size and the other axis', () => {
    const out = alignNormRects(sel, 'left');
    out.forEach((r, i) => {
      const src = sel[i]!;
      expect(r.width).toBeCloseTo(src.width, 9); // size unchanged
      expect(r.height).toBeCloseTo(src.height, 9);
      expect(r.y).toBeCloseTo(src.y, 9); // untouched axis unchanged
    });

    const outV = alignNormRects(sel, 'top');
    outV.forEach((r, i) => {
      const src = sel[i]!;
      expect(r.width).toBeCloseTo(src.width, 9);
      expect(r.height).toBeCloseTo(src.height, 9);
      expect(r.x).toBeCloseTo(src.x, 9); // horizontal untouched by a vertical align
    });
  });

  it('keeps every result a valid normalized rect (0..1, in-page)', () => {
    for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const) {
      for (const r of alignNormRects(sel, mode)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('is idempotent — re-aligning an aligned selection is a no-op', () => {
    const once = alignNormRects(sel, 'left');
    const twice = alignNormRects(once, 'left');
    twice.forEach((r, i) => {
      const prev = once[i]!;
      expect(r.x).toBeCloseTo(prev.x, 9);
      expect(r.y).toBeCloseTo(prev.y, 9);
    });
  });

  it('does not mutate the input rects', () => {
    const before = sel.map((r) => ({ ...r }));
    alignNormRects(sel, 'right');
    sel.forEach((r, i) => expect(r).toEqual(before[i]));
  });

  it('returns fresh copies and is a no-op for < 2 rects', () => {
    expect(alignNormRects([], 'left')).toEqual([]);
    const one: NormRect = { x: 0.3, y: 0.4, width: 0.2, height: 0.1 };
    const out = alignNormRects([one], 'left');
    expect(out[0]).toEqual(one);
    expect(out[0]).not.toBe(one); // fresh copy, safe to mutate downstream
  });
});

describe('distributeNormRects', () => {
  // Deliberately differing widths/heights + scrambled input order, so the tests
  // exercise "equal adjacent gaps" (not equal centers) and order-independence.
  //   x:      0.10   0.40   0.55   0.80   (widths 0.10, 0.20, 0.05, 0.10)
  //   y:      0.05   0.30   0.50   0.70   (heights 0.10, 0.15, 0.05, 0.08)
  const A: NormRect = { x: 0.1, y: 0.05, width: 0.1, height: 0.1 };
  const B: NormRect = { x: 0.4, y: 0.3, width: 0.2, height: 0.15 };
  const C: NormRect = { x: 0.55, y: 0.5, width: 0.05, height: 0.05 };
  const D: NormRect = { x: 0.8, y: 0.7, width: 0.1, height: 0.08 };
  const sel: NormRect[] = [C, A, D, B]; // intentionally unsorted

  // Gaps between adjacent fields once ordered along an axis.
  const gapsAlong = (rects: NormRect[], axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'width' : 'height';
    const ordered = [...rects].sort((a, b) => a[axis] - b[axis]);
    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i++) {
      gaps.push(ordered[i]![axis] - (ordered[i - 1]![axis] + ordered[i - 1]![size]));
    }
    return gaps;
  };

  it('horizontal: makes every adjacent x-gap equal', () => {
    const gaps = gapsAlong(distributeNormRects(sel, 'horizontal'), 'x');
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 9);
    expect(gaps.length).toBe(3);
  });

  it('vertical: makes every adjacent y-gap equal', () => {
    const gaps = gapsAlong(distributeNormRects(sel, 'vertical'), 'y');
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 9);
    expect(gaps.length).toBe(3);
  });

  it('pins the two outermost fields, moving only the ones between', () => {
    const outH = distributeNormRects(sel, 'horizontal');
    const byId = (src: NormRect) => outH[sel.indexOf(src)]!;
    expect(byId(A).x).toBeCloseTo(0.1, 9); // leftmost fixed
    expect(byId(D).x).toBeCloseTo(0.8, 9); // rightmost fixed
    // Interior fields actually shifted from their original x.
    expect(byId(B).x).not.toBeCloseTo(0.4, 6);
    expect(byId(C).x).not.toBeCloseTo(0.55, 6);

    const outV = distributeNormRects(sel, 'vertical');
    const byIdV = (src: NormRect) => outV[sel.indexOf(src)]!;
    expect(byIdV(A).y).toBeCloseTo(0.05, 9); // bottommost fixed
    expect(byIdV(D).y).toBeCloseTo(0.7, 9); // topmost fixed
  });

  it('horizontal: preserves size and the y axis for every field', () => {
    const out = distributeNormRects(sel, 'horizontal');
    out.forEach((r, i) => {
      const src = sel[i]!;
      expect(r.width).toBeCloseTo(src.width, 9);
      expect(r.height).toBeCloseTo(src.height, 9);
      expect(r.y).toBeCloseTo(src.y, 9); // untouched axis unchanged
    });
  });

  it('vertical: preserves size and the x axis for every field', () => {
    const out = distributeNormRects(sel, 'vertical');
    out.forEach((r, i) => {
      const src = sel[i]!;
      expect(r.width).toBeCloseTo(src.width, 9);
      expect(r.height).toBeCloseTo(src.height, 9);
      expect(r.x).toBeCloseTo(src.x, 9);
    });
  });

  it('returns results in the caller original order (not axis-sorted)', () => {
    const out = distributeNormRects(sel, 'horizontal');
    // sel = [C, A, D, B]; sizes must line up with that order.
    expect(out[0]!.width).toBeCloseTo(C.width, 9);
    expect(out[1]!.width).toBeCloseTo(A.width, 9);
    expect(out[2]!.width).toBeCloseTo(D.width, 9);
    expect(out[3]!.width).toBeCloseTo(B.width, 9);
  });

  it('keeps every result a valid normalized rect (0..1, in-page)', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      for (const r of distributeNormRects(sel, axis)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('is idempotent — re-distributing an even selection is a no-op', () => {
    const once = distributeNormRects(sel, 'horizontal');
    const twice = distributeNormRects(once, 'horizontal');
    twice.forEach((r, i) => expect(r.x).toBeCloseTo(once[i]!.x, 9));
  });

  it('does not mutate the input rects', () => {
    const before = sel.map((r) => ({ ...r }));
    distributeNormRects(sel, 'horizontal');
    distributeNormRects(sel, 'vertical');
    sel.forEach((r, i) => expect(r).toEqual(before[i]));
  });

  it('is a no-op returning fresh copies for < 3 rects', () => {
    expect(distributeNormRects([], 'horizontal')).toEqual([]);
    const one: NormRect = { x: 0.3, y: 0.4, width: 0.2, height: 0.1 };
    const outer: NormRect[] = [
      { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
      { x: 0.8, y: 0.8, width: 0.1, height: 0.1 },
    ];
    expect(distributeNormRects([one], 'horizontal')).toEqual([one]);
    expect(distributeNormRects([one], 'horizontal')[0]).not.toBe(one);
    // Two rects: nothing sits between the ends, so both stay put (fresh copies).
    const two = distributeNormRects(outer, 'horizontal');
    expect(two).toEqual(outer);
    expect(two[0]).not.toBe(outer[0]);
  });
});

describe('offsetNormRects', () => {
  // Down-right in bottom-left space = rightward (+x) and downward (−y).
  const DX = 0.03;
  const DY = -0.04;

  it('single: shifts a copy by the delta, size unchanged', () => {
    const src: NormRect = { x: 0.2, y: 0.6, width: 0.26, height: 0.08 };
    const [out] = offsetNormRects([src], DX, DY);
    expect(out!.x).toBeCloseTo(0.23, 9); // x + dx (rightward)
    expect(out!.y).toBeCloseTo(0.56, 9); // y + dy (downward, dy < 0)
    expect(out!.width).toBeCloseTo(src.width, 9); // size preserved
    expect(out!.height).toBeCloseTo(src.height, 9);
  });

  it('applies a literal vector add (down-right is x+dx, y−dy)', () => {
    const src: NormRect = { x: 0.4, y: 0.4, width: 0.1, height: 0.1 };
    const [out] = offsetNormRects([src], 0.05, -0.07);
    expect(out!.x).toBeCloseTo(0.45, 9);
    expect(out!.y).toBeCloseTo(0.33, 9);
  });

  it('multi: applies the same delta so relative layout is preserved', () => {
    const sel: NormRect[] = [
      { x: 0.1, y: 0.7, width: 0.2, height: 0.08 },
      { x: 0.5, y: 0.5, width: 0.15, height: 0.1 },
      { x: 0.3, y: 0.2, width: 0.1, height: 0.06 },
    ];
    const out = offsetNormRects(sel, DX, DY);
    // Every field moved by the identical delta…
    out.forEach((r, i) => {
      expect(r.x).toBeCloseTo(sel[i]!.x + DX, 9);
      expect(r.y).toBeCloseTo(sel[i]!.y + DY, 9);
    });
    // …so pairwise offsets between fields are unchanged (arrangement kept).
    const dOrig = { x: sel[1]!.x - sel[0]!.x, y: sel[1]!.y - sel[0]!.y };
    const dOut = { x: out[1]!.x - out[0]!.x, y: out[1]!.y - out[0]!.y };
    expect(dOut.x).toBeCloseTo(dOrig.x, 9);
    expect(dOut.y).toBeCloseTo(dOrig.y, 9);
  });

  it('multi: preserves every field size', () => {
    const sel: NormRect[] = [
      { x: 0.1, y: 0.7, width: 0.2, height: 0.08 },
      { x: 0.5, y: 0.5, width: 0.15, height: 0.1 },
    ];
    const out = offsetNormRects(sel, DX, DY);
    out.forEach((r, i) => {
      expect(r.width).toBeCloseTo(sel[i]!.width, 9);
      expect(r.height).toBeCloseTo(sel[i]!.height, 9);
    });
  });

  it('clamps a copy pushed past the right/bottom edge back into the page', () => {
    // Field flush to the right edge; offsetting right would overflow.
    const src: NormRect = { x: 1 - 0.26, y: 0.02, width: 0.26, height: 0.08 };
    const [out] = offsetNormRects([src], 0.1, -0.1);
    expect(out!.x + out!.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(out!.y).toBeGreaterThanOrEqual(0);
    expect(out!.width).toBeCloseTo(src.width, 9); // size still preserved through clamp
    expect(out!.height).toBeCloseTo(src.height, 9);
  });

  it('keeps every result a valid in-page normalized rect', () => {
    const sel: NormRect[] = [
      { x: 0.9, y: 0.05, width: 0.08, height: 0.05 },
      { x: 0.02, y: 0.95, width: 0.1, height: 0.06 },
    ];
    for (const r of offsetNormRects(sel, 0.2, -0.2)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('does not mutate the input and returns fresh copies', () => {
    const sel: NormRect[] = [{ x: 0.3, y: 0.4, width: 0.2, height: 0.1 }];
    const before = sel.map((r) => ({ ...r }));
    const out = offsetNormRects(sel, DX, DY);
    sel.forEach((r, i) => expect(r).toEqual(before[i]));
    expect(out[0]).not.toBe(sel[0]);
  });

  it('is a no-op returning [] for an empty selection', () => {
    expect(offsetNormRects([], DX, DY)).toEqual([]);
  });
});
