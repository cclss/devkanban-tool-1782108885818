/**
 * Pure coordinate-system bridge for placing sign fields onto a PDF page.
 *
 * Two coordinate systems meet here (mirrors `apps/web/src/lib/field-geometry.ts`,
 * the placement side of the same contract):
 *
 *   • Stored / normalized space — **bottom-left origin**, +x right, +y UP,
 *     ratios in 0..1 relative to the page *as the signer sees it* (i.e. the
 *     rotation-applied, visible page). `x`/`y` are the field's lower-left corner;
 *     `width`/`height` are page-relative spans. This is exactly the persisted
 *     `SignField` shape (see `documents.dto.ts` / web `pxToNorm`).
 *   • PDF page space — bottom-left origin too, but in points relative to the
 *     page's *unrotated* media box. This is what `pdf-lib`'s draw calls consume;
 *     a page's `/Rotate` is applied by the viewer on top of these coordinates.
 *
 * When a page has a non-zero `/Rotate`, the visible page the signer placed
 * fields on is rotated relative to the media box, so a normalized rect must be
 * transformed back into unrotated media-box space *and* the drawn content must
 * be counter-rotated so it appears upright to the reader. {@link resolveFieldPlacement}
 * does both; {@link localToPage} maps a point inside the placed box (e.g. a text
 * baseline or a centered image corner) into media-box coordinates.
 *
 * Everything here is dependency-free and pure, so the transforms are unit-tested
 * in isolation (`field-geometry.spec.ts`).
 */

/** A field rect in normalized PDF space (bottom-left origin, 0..1 of the page). */
export interface NormRect {
  /** Lower-left corner X, 0..1 of the visible page width. */
  x: number;
  /** Lower-left corner Y, 0..1 of the visible page height (from the bottom). */
  y: number;
  /** Width, 0..1 of the visible page width. */
  width: number;
  /** Height, 0..1 of the visible page height. */
  height: number;
}

/** The unrotated media-box size of a PDF page, in points. */
export interface PageSize {
  width: number;
  height: number;
}

/** A page rotation in degrees clockwise — always a multiple of 90 per the PDF spec. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * A resolved placement in unrotated media-box space, ready for `pdf-lib`:
 * `(x, y)` is the box's anchor (the bottom-left of the upright content frame),
 * `width`/`height` are the box's on-screen size in points, and `rotation` is the
 * angle (degrees, counter-clockwise — `pdf-lib`'s convention) to pass as the
 * draw `rotate` so the content reads upright once the viewer applies `/Rotate`.
 */
export interface FieldPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: Rotation;
}

/** Exact cos/sin for the four right angles (avoids `Math.cos` float dust). */
const TRIG: Record<Rotation, { cos: -1 | 0 | 1; sin: -1 | 0 | 1 }> = {
  0: { cos: 1, sin: 0 },
  90: { cos: 0, sin: 1 },
  180: { cos: -1, sin: 0 },
  270: { cos: 0, sin: -1 },
};

/**
 * Normalize an arbitrary page-rotation angle to one of `0 | 90 | 180 | 270`.
 * Handles negatives and values ≥ 360; rounds to the nearest right angle so odd
 * `/Rotate` values (rare, malformed PDFs) still resolve deterministically.
 */
export function normalizeRotation(angle: number): Rotation {
  const snapped = Math.round(angle / 90) * 90;
  const wrapped = ((snapped % 360) + 360) % 360;
  return wrapped as Rotation;
}

/**
 * Normalize an absolute rect given in **bottom-left, points** page space into
 * the stored {@link NormRect} shape (0..1 ratios, bottom-left origin). This is
 * the exact inverse of the `field.x * width` scaling {@link resolveFieldPlacement}
 * applies, so extraction (points → normalized) and placement (normalized →
 * points) share one coordinate convention.
 *
 * Ratios are clamped to 0..1 so a glyph whose box slightly overruns the media
 * box (common with italics/overhang) still yields a valid stored rect. A
 * non-positive page dimension collapses that axis to 0 rather than dividing by
 * zero.
 */
export function normalizeRect(
  rect: { x: number; y: number; width: number; height: number },
  page: PageSize,
): NormRect {
  const nx = page.width > 0 ? rect.x / page.width : 0;
  const ny = page.height > 0 ? rect.y / page.height : 0;
  const nw = page.width > 0 ? rect.width / page.width : 0;
  const nh = page.height > 0 ? rect.height / page.height : 0;
  return {
    x: clamp01(nx),
    y: clamp01(ny),
    width: clamp01(nw),
    height: clamp01(nh),
  };
}

/** Clamp a ratio into the inclusive 0..1 range. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Resolve a normalized field rect (relative to the visible page) into an
 * unrotated media-box placement plus the counter-rotation to draw with.
 *
 * The visible page size is the media box with its axes swapped for 90°/270°
 * rotations. The lower-left corner of the box in visible space is mapped back to
 * media-box space per rotation; the content width/height stay the on-screen
 * dimensions (since the content is drawn upright relative to the reader).
 */
export function resolveFieldPlacement(
  field: NormRect,
  page: PageSize,
  rotationDegrees: number,
): FieldPlacement {
  const rotation = normalizeRotation(rotationDegrees);
  const quarter = rotation === 90 || rotation === 270;

  // Visible page size: axes swap for quarter turns.
  const visW = quarter ? page.height : page.width;
  const visH = quarter ? page.width : page.height;

  // The box in visible space (bottom-left origin), in points.
  const lx = field.x * visW; // left edge from visible left
  const ly = field.y * visH; // bottom edge from visible bottom
  const w = field.width * visW; // on-screen width
  const h = field.height * visH; // on-screen height

  // Map the visible-space lower-left corner back into unrotated media-box space.
  // (Derivation: invert the unrotated→display mapping for each /Rotate value.)
  let x: number;
  let y: number;
  switch (rotation) {
    case 90:
      x = page.width - ly;
      y = lx;
      break;
    case 180:
      x = page.width - lx;
      y = page.height - ly;
      break;
    case 270:
      x = ly;
      y = page.height - lx;
      break;
    default: // 0
      x = lx;
      y = ly;
  }

  return { x, y, width: w, height: h, rotation };
}

/**
 * Map a point given in the placed box's *local* upright frame — origin at the
 * box's bottom-left, +u right, +v up, in points — into unrotated media-box
 * coordinates. Use this to position a text baseline or a centered image corner
 * inside the box; draw with `rotate` = the placement's `rotation`.
 */
export function localToPage(
  placement: FieldPlacement,
  u: number,
  v: number,
): { x: number; y: number } {
  const { cos, sin } = TRIG[placement.rotation];
  return {
    x: placement.x + u * cos - v * sin,
    y: placement.y + u * sin + v * cos,
  };
}
