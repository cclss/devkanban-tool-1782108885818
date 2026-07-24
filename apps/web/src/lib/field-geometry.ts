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
