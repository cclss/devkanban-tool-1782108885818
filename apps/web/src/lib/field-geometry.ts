/**
 * Sign-field geometry: the coordinate-system bridge between the placement canvas
 * and the persisted, page-relative field model.
 *
 * Two coordinate systems meet here:
 *
 *   • Canvas space — top-left origin, +x right, +y DOWN. Pixels, relative to the
 *     rendered PDF page (the `<canvas>` raster). This is how the browser lays out
 *     the field overlay while the sender drags.
 *   • PDF / normalized space — bottom-left origin, +x right, +y UP. Ratios in
 *     0..1 relative to the page. This is the stored shape (grain-3 contract:
 *     `SignFieldDto` normalized 0..1) and what `pdf-lib` later consumes.
 *
 * Keeping every transform here (and free of any DOM dependency) is what lets the
 * placement survive zoom and page changes — normalized ratios are scale-free, so
 * re-rendering the page at any pixel size reproduces the exact same field box —
 * and what makes the conversion unit-testable in isolation.
 */

export type SignFieldType = 'SIGNATURE' | 'DATE' | 'TEXT';

/** A rect in canvas space: top-left origin, pixels relative to the page raster. */
export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The rendered pixel size of a PDF page (the overlay's coordinate basis). */
export interface PageSize {
  width: number;
  height: number;
}

/**
 * A rect in normalized PDF space: bottom-left origin, 0..1 of the page. `x`/`y`
 * are the field's lower-left corner; `width`/`height` are page-relative spans.
 * This is exactly the persisted/server shape.
 */
export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest field a user can resize to (page-relative), keeps fields grabbable. */
export const MIN_NORM_WIDTH = 0.04;
export const MIN_NORM_HEIGHT = 0.025;

export const FIELD_TYPES: readonly SignFieldType[] = ['SIGNATURE', 'DATE', 'TEXT'] as const;

export interface FieldTypeMeta {
  type: SignFieldType;
  /** Korean label shown on the tool + the placed field. */
  label: string;
  /** Default normalized size when first dropped. */
  defaultSize: { width: number; height: number };
}

/** Per-type display + default footprint. Sizes are page-relative (0..1). */
export const FIELD_TYPE_META: Record<SignFieldType, FieldTypeMeta> = {
  SIGNATURE: { type: 'SIGNATURE', label: '서명', defaultSize: { width: 0.26, height: 0.08 } },
  DATE: { type: 'DATE', label: '날짜', defaultSize: { width: 0.18, height: 0.05 } },
  TEXT: { type: 'TEXT', label: '텍스트', defaultSize: { width: 0.28, height: 0.06 } },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Canvas pixels → normalized PDF rect.
 *
 * The width/height ratios are direct, but `y` flips axis: the field's bottom
 * edge sits `top + height` pixels below the top, i.e. `page.height - (top +
 * height)` pixels above the bottom — normalized, that's the lower-left `y`.
 */
export function pxToNorm(rect: PxRect, page: PageSize): NormRect {
  const w = page.width || 1;
  const h = page.height || 1;
  return {
    x: rect.left / w,
    y: (h - (rect.top + rect.height)) / h,
    width: rect.width / w,
    height: rect.height / h,
  };
}

/**
 * Normalized PDF rect → canvas pixels. Inverse of {@link pxToNorm}; re-flips `y`
 * back to a top-left origin. Independent of the page size used at store time,
 * so a field stored at one zoom restores exactly at any other.
 */
export function normToPx(rect: NormRect, page: PageSize): PxRect {
  return {
    left: rect.x * page.width,
    top: (1 - rect.y - rect.height) * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
}

/**
 * Clamp a normalized rect so it stays a valid in-page box: size within
 * [min, 1], and fully inside the page (origin pushed in if it would overflow).
 */
export function clampNormRect(rect: NormRect): NormRect {
  const width = clamp(rect.width, MIN_NORM_WIDTH, 1);
  const height = clamp(rect.height, MIN_NORM_HEIGHT, 1);
  const x = clamp(rect.x, 0, 1 - width);
  const y = clamp(rect.y, 0, 1 - height);
  return { x, y, width, height };
}

/**
 * How to line up a set of fields. Horizontal modes touch only `x`; vertical
 * modes touch only `y`. The two "center" cases are per-axis, hence distinct
 * names (`hcenter` = shared vertical center-line, `vcenter` = shared horizontal
 * center-line).
 */
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Line up a selection of normalized rects against their shared bounding box.
 *
 * The reference is the group's bounding box — the min/max edges across the whole
 * selection (leftmost `x`, rightmost `x+width`, bottom `y`, top `y+height`) —
 * not the last-picked field. This matches the keynote/slides convention where
 * "align left" pins everything to the group's leftmost edge, and it's
 * order-independent, so re-running any align is idempotent.
 *
 * Only the affected axis moves; the other axis, and every field's size, are left
 * untouched. Because targets are derived from the selection's own edges (all in
 * 0..1), the results stay valid normalized rects — no clamping needed.
 *
 * The Y axis is bottom-left origin: `top` pins the box's upper edge, so a field's
 * new `y` is `maxTop - height`; `bottom` pins the lower edge, so `y = minBottom`.
 * Fewer than two rects is a no-op (each is already aligned to itself), returned
 * as fresh copies for caller-safety.
 */
export function alignNormRects(rects: readonly NormRect[], mode: AlignMode): NormRect[] {
  if (rects.length === 0) return [];

  const minLeft = Math.min(...rects.map((r) => r.x));
  const maxRight = Math.max(...rects.map((r) => r.x + r.width));
  const minBottom = Math.min(...rects.map((r) => r.y));
  const maxTop = Math.max(...rects.map((r) => r.y + r.height));
  const midX = (minLeft + maxRight) / 2;
  const midY = (minBottom + maxTop) / 2;

  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { ...r, x: minLeft };
      case 'right':
        return { ...r, x: maxRight - r.width };
      case 'hcenter':
        return { ...r, x: midX - r.width / 2 };
      case 'top':
        return { ...r, y: maxTop - r.height };
      case 'bottom':
        return { ...r, y: minBottom };
      case 'vcenter':
        return { ...r, y: midY - r.height / 2 };
    }
  });
}

/**
 * Which axis to even out spacing along. `horizontal` touches only `x` (and
 * orders/pins by the left/right fields); `vertical` touches only `y` (orders/pins
 * by the bottom/top fields, bottom-left origin).
 */
export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Even out the spacing of a selection along one axis, pinning the two outermost
 * fields and re-flowing the ones between them.
 *
 * Spacing rule — **equal adjacent gaps** (edge-to-edge), not equal centers. The
 * interior region runs from the first field's trailing edge to the last field's
 * leading edge; the middle fields' own extents subtract out, and the remainder is
 * split into `n-1` equal gaps — one between each adjacent pair. This is the
 * keynote/slides "distribute" convention and the one the spec asks for
 * ("인접 필드 간 간격이 동일") — it stays correct when fields differ in size, where
 * equal-center spacing would leave visibly uneven gaps.
 *
 * The two outermost fields keep their stored position exactly (returned as fresh
 * copies, untouched). Only the distributed axis moves; every field's size and the
 * other axis are preserved, so results stay valid normalized rects (0..1,
 * bottom-left origin) with no clamping — same guarantee as {@link alignNormRects}.
 *
 * Fields are ordered by their leading edge along the axis (stable on ties), but
 * the result is returned in the caller's original order so it maps back to the
 * selection by index. Fewer than three rects is a no-op (nothing sits "between"
 * two ends), returned as fresh copies for caller-safety.
 */
export function distributeNormRects(
  rects: readonly NormRect[],
  axis: DistributeAxis,
): NormRect[] {
  const out = rects.map((r) => ({ ...r }));
  if (out.length < 3) return out;

  const horizontal = axis === 'horizontal';
  const pos = (r: NormRect): number => (horizontal ? r.x : r.y);
  const size = (r: NormRect): number => (horizontal ? r.width : r.height);

  // Order indices by leading edge; ties keep input order (stable) so
  // equal-position fields don't jitter.
  const order = out
    .map((_, i) => i)
    .sort((a, b) => pos(out[a]!) - pos(out[b]!));

  const first = out[order[0]!]!;
  const last = out[order[order.length - 1]!]!;

  // Interior span = first field's trailing edge → last field's leading edge.
  // Subtract the middle fields' extents; split what's left into n-1 equal gaps.
  const innerStart = pos(first) + size(first);
  const innerEnd = pos(last);
  let sumMiddle = 0;
  for (let i = 1; i < order.length - 1; i++) sumMiddle += size(out[order[i]!]!);
  const gap = (innerEnd - innerStart - sumMiddle) / (order.length - 1);

  // Walk left→right (or bottom→top), placing each middle field one gap past the
  // previous field's trailing edge. The outer two fields are never touched.
  let cursor = innerStart;
  for (let i = 1; i < order.length - 1; i++) {
    const r = out[order[i]!]!;
    const next = cursor + gap;
    if (horizontal) r.x = next;
    else r.y = next;
    cursor = next + size(r);
  }

  return out;
}

/**
 * Translate a selection of normalized rects by one shared delta, then keep each
 * inside the page.
 *
 * Applying the *same* `(dx, dy)` to every rect is what preserves the selection's
 * relative layout — the gaps between fields are unchanged, so duplicating a group
 * reproduces its exact arrangement, just shifted. Sizes are never touched.
 *
 * Axis convention is normalized/bottom-left origin (see file header), so a delta
 * is a literal vector add: `x + dx`, `y + dy`. To drop the copy at the spec's
 * "slightly down-right" of the original, the caller passes `dx > 0` (rightward)
 * and `dy < 0` (downward) — i.e. down-right is `x + dx, y − dy`.
 *
 * Each result is passed through {@link clampNormRect} so a copy pushed past a page
 * edge is pulled back to a valid in-page box (0..1). Clamping is per-rect: in the
 * ordinary case (small offset, interior fields) it's a no-op and the arrangement
 * is exact; only a field already at the far edge is nudged in, where staying
 * on-page takes priority over reproducing the offset to the pixel.
 *
 * Empty input returns `[]`; otherwise fresh rects are returned (input untouched).
 */
export function offsetNormRects(rects: readonly NormRect[], dx: number, dy: number): NormRect[] {
  return rects.map((r) => clampNormRect({ ...r, x: r.x + dx, y: r.y + dy }));
}

/**
 * Move a selection of normalized rects by one shared delta, clamping the *group*
 * (not each rect) so the whole selection stops together at a page edge.
 *
 * This is the move-as-one contract for arrow-key nudge and multi-drag: the
 * selection's relative layout — every gap and every size — is preserved exactly,
 * even when one field is already flush against a page edge. The whole group halts
 * as soon as its bounding box hits the boundary, so nothing slides relative to
 * its neighbours.
 *
 * That's the deliberate difference from {@link offsetNormRects}, which clamps each
 * rect independently: per-rect clamping is right for *duplicate* (a copy pushed
 * off-page is pulled back on its own, arrangement is secondary), but wrong for
 * *move* (an edge field would stop while the rest keep going, shearing the
 * arrangement). Here we clamp once, against the selection's shared bounding box.
 *
 * The requested delta is applied to the bounding box origin, then clamped to the
 * page so the box's far edge stays within 1.0 (`x + dx` bounded to
 * `[0, 1 − boxWidth]`, same for y in the bottom-left axis). The *effective* delta
 * — the shift the box actually took after clamping — is then added to every rect,
 * which is what keeps the group rigid. In the ordinary case (small nudge, group
 * well inside the page) the clamp is a no-op and the move is exact.
 *
 * Sizes are never touched. Empty input returns `[]`; otherwise fresh rects are
 * returned (input untouched). A group larger than the page collapses to the
 * origin corner rather than overflowing.
 */
export function translateNormRects(rects: readonly NormRect[], dx: number, dy: number): NormRect[] {
  if (rects.length === 0) return [];

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));

  // Clamp the group's bounding box, not each rect: bound the shifted origin so
  // the box stays fully in-page, then re-derive the delta the box really moved.
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const appliedDx = clamp(minX + dx, 0, Math.max(0, 1 - boxWidth)) - minX;
  const appliedDy = clamp(minY + dy, 0, Math.max(0, 1 - boxHeight)) - minY;

  return rects.map((r) => ({ ...r, x: r.x + appliedDx, y: r.y + appliedDy }));
}

/**
 * Clamp a pixel rect to stay fully within the page raster, preserving size where
 * possible (used for live drag/resize feedback before normalizing on commit).
 */
export function clampPxRect(rect: PxRect, page: PageSize): PxRect {
  const width = clamp(rect.width, MIN_NORM_WIDTH * page.width, page.width);
  const height = clamp(rect.height, MIN_NORM_HEIGHT * page.height, page.height);
  const left = clamp(rect.left, 0, page.width - width);
  const top = clamp(rect.top, 0, page.height - height);
  return { left, top, width, height };
}

/**
 * Build a default-sized field box (in canvas px) centered on a drop point, then
 * clamped inside the page. Used when a tool is dropped onto the canvas.
 */
export function defaultPxRectAt(
  type: SignFieldType,
  center: { x: number; y: number },
  page: PageSize,
): PxRect {
  const size = FIELD_TYPE_META[type].defaultSize;
  const width = size.width * page.width;
  const height = size.height * page.height;
  return clampPxRect(
    { left: center.x - width / 2, top: center.y - height / 2, width, height },
    page,
  );
}

/** Resize handles, named by compass direction. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
] as const;

/**
 * Apply a pixel delta to one edge/corner of a rect, keeping the opposite
 * edge(s) pinned. Returns the new (unclamped) px rect; caller clamps.
 */
export function resizePxRect(rect: PxRect, handle: ResizeHandle, dx: number, dy: number): PxRect {
  let { left, top, width, height } = rect;
  const right = left + width;
  const bottom = top + height;

  if (handle.includes('w')) {
    left = left + dx;
    width = right - left;
  }
  if (handle.includes('e')) {
    width = width + dx;
  }
  if (handle.includes('n')) {
    top = top + dy;
    height = bottom - top;
  }
  if (handle.includes('s')) {
    height = height + dy;
  }
  return { left, top, width, height };
}

/**
 * True when two px rects overlap by any positive area. Edge-only contact (zero
 * overlap area) does NOT count, so a click (zero-size marquee) selects nothing.
 * Pure geometry — used by marquee hit-testing.
 */
export function rectsIntersect(a: PxRect, b: PxRect): boolean {
  const overlapW = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const overlapH = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return overlapW > 0 && overlapH > 0;
}

/**
 * Build a normalized (non-negative width/height) px rect from a drag anchor to a
 * current point, regardless of drag direction. This is how a marquee box is
 * derived from where the pointer went down and where it is now.
 */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): PxRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { left, top, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/**
 * Ids of items whose px rect intersects the marquee rect. Items carry their own
 * id + rect so this stays DOM-free and independent of the field model shape.
 */
export function marqueeHitTest(
  marquee: PxRect,
  items: readonly { id: string; rect: PxRect }[],
): string[] {
  return items.filter((it) => rectsIntersect(marquee, it.rect)).map((it) => it.id);
}

/** Candidate snap line in one axis (px), with the value it represents. */
export interface SnapLine {
  axis: 'x' | 'y';
  /** Pixel position of the guide line. */
  pos: number;
}

/**
 * Snap a moving rect's edges/center to page guides (page center + page edges)
 * and to peer rects' edges/centers, within `threshold` px. Returns the adjusted
 * rect plus the guide lines that actually engaged (for rendering).
 *
 * Pure geometry: peers are plain px rects, so this is trivially testable.
 */
export function snapMove(
  rect: PxRect,
  page: PageSize,
  peers: PxRect[],
  threshold: number,
): { rect: PxRect; guides: SnapLine[] } {
  const guides: SnapLine[] = [];

  // X-axis candidate target lines: page edges + center, peer edges + centers.
  const xTargets = [0, page.width / 2, page.width];
  const yTargets = [0, page.height / 2, page.height];
  for (const p of peers) {
    xTargets.push(p.left, p.left + p.width / 2, p.left + p.width);
    yTargets.push(p.top, p.top + p.height / 2, p.top + p.height);
  }

  let { left, top } = rect;
  const { width, height } = rect;

  // For each axis, test the rect's near-edge, center, and far-edge against every
  // target; snap to the closest within threshold (edges win ties by order).
  const snapAxis = (
    start: number,
    span: number,
    targets: number[],
    axis: 'x' | 'y',
  ): number => {
    let best: { delta: number; pos: number } | null = null;
    const anchors = [start, start + span / 2, start + span];
    for (const t of targets) {
      for (const a of anchors) {
        const delta = t - a;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, pos: t };
        }
      }
    }
    if (best) {
      guides.push({ axis, pos: best.pos });
      return start + best.delta;
    }
    return start;
  };

  left = snapAxis(left, width, xTargets, 'x');
  top = snapAxis(top, height, yTargets, 'y');

  return { rect: { left, top, width, height }, guides };
}
