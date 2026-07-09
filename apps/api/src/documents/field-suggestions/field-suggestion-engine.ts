/**
 * Text-heuristic field-suggestion engine — the pure core of the AI auto-placement
 * feature (기획서 M1). Given a PDF's extracted text layer (grain-2) and the anchor
 * keyword config (grain-1), it proposes draft sign-field boxes near each anchor.
 *
 * ## Contract
 * Output is a `SignFieldDto[]` (the exact persisted/frontend shape): every box is
 * normalized `0..1`, **PDF bottom-left origin**, and `recipientIndex = 0` (single
 * signer per the plan's confirmed constraint). Downstream save/sign/PDF pipelines
 * consume it unchanged. An input with no text layer (scanned/image-only PDF) or
 * no anchor matches yields an **empty array** — the manual-placement fallback.
 *
 * ## Purity
 * Every function here is pure: same input → same output, no IO, no shared state.
 * PDF parsing lives in `pdf-text-extraction.ts` (grain-2); this module never
 * touches the file system, network, or clock.
 *
 * ## Reuse (no re-defined constants)
 * The coordinate convention, per-type default footprints, and in-page clamp all
 * come from the single source of truth `@repo/field-geometry`
 * ({@link FIELD_TYPE_META}, {@link clampNormRect}) — this engine defines **no**
 * geometry constants of its own, so it can never drift from the placement canvas.
 * Anchor keyword sets come from `./anchor-keywords`.
 *
 * ## Coordinate mapping (round-trippable, see the boundary requirement)
 * The extractor and the normalized contract share one origin (bottom-left, +y up),
 * so page-space ↔ normalized is a pure per-axis scale with **no axis flip**. That
 * mapping is exposed as a separate transform/inverse pair
 * ({@link pageRectToNorm} / {@link normRectToPage}) so the coordinate round-trip
 * is unit-testable in isolation (grain-4). Box *placement* (offset + clamp) is a
 * separate step layered on top of that mapping.
 */

import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  clampNormRect,
  type NormRect,
  type PageSize,
  type SignFieldType,
} from '@repo/field-geometry';

import { SignFieldDto, SignFieldTypeDto } from '../dto/documents.dto';
import { ANCHOR_KEYWORDS } from './anchor-keywords';
import type { PageRect, PdfTextLayer } from './pdf-text-extraction';

/**
 * Draft-placement tuning surface for where a suggested box lands relative to its
 * anchor. Kept in one spot (like `ANCHOR_KEYWORDS`) so the heuristic can be tuned
 * without hunting through logic. Gaps are page-relative (0..1), matching the
 * normalized coordinate space.
 *
 * Direction rule: a field is drafted to the **right** of its anchor, vertically
 * centered on it (the common `서명:` / `날짜:` label-then-blank layout). When the
 * right margin can't fit the default box, it falls **below** the anchor with left
 * edges aligned. `clampNormRect` then guarantees the result is a valid in-page box.
 */
export const DRAFT_PLACEMENT = {
  /** Horizontal gap between an anchor's right edge and the field (page-relative). */
  gapX: 0.01,
  /** Vertical gap between an anchor's bottom edge and a below-placed field. */
  gapY: 0.01,
} as const;

/**
 * Page-space rect → normalized rect (both bottom-left origin, so a pure per-axis
 * divide — no flip). `page` is the page's point size. The inverse is
 * {@link normRectToPage}; together they round-trip exactly (modulo float).
 */
export function pageRectToNorm(rect: PageRect, page: PageSize): NormRect {
  const w = page.width || 1;
  const h = page.height || 1;
  return {
    x: rect.x / w,
    y: rect.y / h,
    width: rect.width / w,
    height: rect.height / h,
  };
}

/**
 * Normalized rect → page-space rect. Exact inverse of {@link pageRectToNorm}
 * (per-axis multiply, no flip). Exposed so the coordinate mapping can be
 * round-trip tested independently of placement.
 */
export function normRectToPage(rect: NormRect, page: PageSize): PageRect {
  return {
    x: rect.x * page.width,
    y: rect.y * page.height,
    width: rect.width * page.width,
    height: rect.height * page.height,
  };
}

/** Collapse whitespace + lower-case so keyword matching is layout/case tolerant. */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Classify a text fragment as an anchor for one field type, or `null` if it
 * matches none. Matching is case-insensitive, whitespace-collapsed `contains`
 * against {@link ANCHOR_KEYWORDS} (so `년   월   일` still matches `년 월 일`).
 *
 * A fragment can hit several keyword sets (e.g. `성명` anchors both SIGNATURE and
 * TEXT). To keep one draft box per anchor, the first type in the geometry
 * contract's order ({@link FIELD_TYPES}: SIGNATURE → DATE → TEXT) wins.
 */
export function matchAnchorType(text: string): SignFieldType | null {
  const haystack = normalizeForMatch(text);
  if (haystack.length === 0) return null;

  for (const type of FIELD_TYPES) {
    const keywords = ANCHOR_KEYWORDS[type];
    for (const keyword of keywords) {
      if (haystack.includes(normalizeForMatch(keyword))) return type;
    }
  }
  return null;
}

/**
 * Derive a normalized field box for one anchor: apply the type's default footprint
 * ({@link FIELD_TYPE_META}) at the placement offset ({@link DRAFT_PLACEMENT}), then
 * clamp inside the page ({@link clampNormRect}). Both `anchor` and the result are
 * normalized (bottom-left origin, 0..1). Pure — no reference to page pixels.
 */
export function placeFieldBox(type: SignFieldType, anchor: NormRect): NormRect {
  const size = FIELD_TYPE_META[type].defaultSize;

  // Primary: to the right of the anchor, vertically centered on it.
  const rightX = anchor.x + anchor.width + DRAFT_PLACEMENT.gapX;
  const centeredY = anchor.y + anchor.height / 2 - size.height / 2;

  const candidate: NormRect =
    rightX + size.width <= 1
      ? { x: rightX, y: centeredY, width: size.width, height: size.height }
      : // Fallback: below the anchor, left edges aligned.
        {
          x: anchor.x,
          y: anchor.y - DRAFT_PLACEMENT.gapY - size.height,
          width: size.width,
          height: size.height,
        };

  return clampNormRect(candidate);
}

/**
 * The engine entry point: extracted text layer → draft `SignFieldDto[]`.
 *
 * For every text fragment that matches an anchor keyword, emit one field of the
 * matched type placed near that fragment (right/below, default-sized, clamped),
 * all with `recipientIndex = 0`. Fragments are visited in page-then-document
 * order, so the output order is deterministic.
 *
 * Returns `[]` when there is no text layer or nothing matches — the caller turns
 * that into the manual-placement fallback.
 */
export function suggestSignFields(textLayer: PdfTextLayer): SignFieldDto[] {
  if (!textLayer.hasTextLayer) return [];

  const fields: SignFieldDto[] = [];

  for (const page of textLayer.pages) {
    const pageSize: PageSize = { width: page.width, height: page.height };

    for (const fragment of page.fragments) {
      const type = matchAnchorType(fragment.text);
      if (type === null) continue;

      const anchor = pageRectToNorm(fragment.bbox, pageSize);
      const box = placeFieldBox(type, anchor);

      fields.push({
        type: SignFieldTypeDto[type],
        page: page.page,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        recipientIndex: 0,
      });
    }
  }

  return fields;
}
