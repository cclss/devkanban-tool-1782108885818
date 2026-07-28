/**
 * Per-page phrase + position extraction from a text-selectable PDF.
 *
 * The upstream loader (`pdf.ts`) hands us an open pdfjs document; this module
 * walks each page's `getTextContent()` items and turns them into a page-grouped
 * list of {@link Phrase}s, each carrying its position as a field-geometry
 * {@link NormRect} — the *same* coordinate contract the placement canvas stores
 * (`SignFieldDto`: bottom-left origin, +y up, 0..1 of the page). Downstream
 * anchor classification / auto-placement can therefore consume a phrase's `rect`
 * as a field box with zero coordinate conversion.
 *
 * Why the raw pdfjs `TextItem` isn't enough on its own:
 *   • Position lives in `item.transform` (a text matrix); `transform[4..5]` is the
 *     glyph-run baseline origin in *PDF user space* — already bottom-left / y-up,
 *     the same axis as `NormRect`, so normalizing is a divide by the page's
 *     point size, no y-flip (unlike the canvas-pixel `pxToNorm`).
 *   • pdfjs splits a visual line into many items (per font run / per space). An
 *     anchor like "성명 :" spans several items, so we merge items that sit on the
 *     same baseline within a small horizontal gap into one phrase.
 *
 * Purity: no DOM, no pdfjs import. The runtime document/page objects are passed
 * in; the merge+normalize math ({@link phrasesForPage}) is a pure function over
 * plain {@link TextItemLike}s, so it unit-tests without a browser or a real PDF.
 *
 * Rotation caveat: `item.transform` is in the page's *unrotated* user space, and
 * we normalize against the unrotated mediabox (`page.view`). Pages with a
 * `/Rotate` entry are therefore reported in unrotated space; rotation-aware
 * normalization is deferred to the placement grain (see design-spec §Out-of-scope).
 */

import type { NormRect } from './field-geometry';
import type { PdfDocument } from './pdf';

/**
 * The subset of a pdfjs `TextItem` this module reads. Declared structurally so
 * the merge logic is testable with plain objects and stays decoupled from the
 * pdfjs type surface.
 */
export interface TextItemLike {
  /** The item's text (may be empty or whitespace-only for spacing runs). */
  str: string;
  /** Text matrix `[a, b, c, d, e, f]`; `e`/`f` = baseline origin in PDF points. */
  transform: number[];
  /** Advance width of the run, in PDF points (same units as `transform`). */
  width: number;
  /** Font height of the run, in PDF points (≈ font size). */
  height: number;
  /** pdfjs flag: this item is the last on its visual line. */
  hasEOL?: boolean;
}

/** A merged run of text on one line, with its position as a stored field box. */
export interface Phrase {
  /** Collapsed, trimmed text of the run. Never empty. */
  text: string;
  /** 1-based page number this phrase was found on. */
  page: number;
  /** Position as a field-geometry NormRect (bottom-left origin, 0..1). */
  rect: NormRect;
}

/** All phrases extracted from a single page, keyed by 1-based page number. */
export interface PagePhrases {
  page: number;
  phrases: Phrase[];
}

// --- Merge tolerances (fractions of the run's font height) ------------------
// Expressed relative to font height so they scale with text size rather than
// being pinned to an absolute point value.

/** Baseline delta under which two runs count as the same visual line. */
const LINE_BASELINE_TOL = 0.5;
/** Horizontal gap under which two same-line runs merge into one phrase. */
const WORD_GAP_TOL = 0.6;
/** Gap above which a single space is inserted between merged runs. */
const SPACE_GAP_TOL = 0.15;
/** How far below the baseline a run's box extends (descender allowance). */
const DESCENT_RATIO = 0.2;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Clamp a normalized rect fully inside the page (0..1, no overflow past edges). */
function clampToPage(rect: NormRect): NormRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    width: clamp01(Math.min(rect.width, 1 - x)),
    height: clamp01(Math.min(rect.height, 1 - y)),
  };
}

interface RunGroup {
  parts: string[];
  endsWithSpace: boolean;
  hasInk: boolean;
  /** Ink bounding box in PDF points (bottom-left space). */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Trailing-edge trackers from the last appended item (for line/gap tests). */
  lastRight: number;
  lastBaseline: number;
  lastHeight: number;
  prevEOL: boolean;
}

function newGroup(): RunGroup {
  return {
    parts: [],
    endsWithSpace: false,
    hasInk: false,
    left: Infinity,
    right: -Infinity,
    top: -Infinity,
    bottom: Infinity,
    lastRight: 0,
    lastBaseline: 0,
    lastHeight: 0,
    prevEOL: false,
  };
}

function isTextItem(item: unknown): item is TextItemLike {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as TextItemLike).str === 'string' &&
    Array.isArray((item as TextItemLike).transform)
  );
}

/**
 * Pure core: merge a page's text items into phrases, positioned as NormRects.
 *
 * `pageWidth`/`pageHeight` and `originX`/`originY` describe the page's mediabox
 * in PDF points (`page.view` = `[x0, y0, x1, y1]`). Items are assumed to arrive
 * in reading order (pdfjs content-stream order).
 */
export function phrasesForPage(
  items: TextItemLike[],
  page: number,
  pageWidth: number,
  pageHeight: number,
  originX = 0,
  originY = 0,
): Phrase[] {
  const w = pageWidth || 1;
  const h = pageHeight || 1;
  const phrases: Phrase[] = [];
  let group: RunGroup | null = null;

  const flush = () => {
    if (group && group.hasInk) {
      const text = group.parts.join('').replace(/\s+/g, ' ').trim();
      if (text.length > 0) {
        phrases.push({
          text,
          page,
          rect: clampToPage({
            x: (group.left - originX) / w,
            y: (group.bottom - originY) / h,
            width: (group.right - group.left) / w,
            height: (group.top - group.bottom) / h,
          }),
        });
      }
    }
    group = null;
  };

  for (const item of items) {
    const raw = item.str ?? '';
    const t = item.transform;
    const height = item.height || Math.hypot(t[1] ?? 0, t[3] ?? 0) || 0;
    const left = t[4] ?? 0;
    const baseline = t[5] ?? 0;
    const right = left + (item.width || 0);
    const isBlank = raw.trim().length === 0;

    // Decide whether this item continues the current phrase or starts a new one.
    if (group) {
      const maxH = Math.max(group.lastHeight || height, height) || 1;
      const sameLine = Math.abs(baseline - group.lastBaseline) <= LINE_BASELINE_TOL * maxH;
      const gap = left - group.lastRight;
      const adjacent = gap <= WORD_GAP_TOL * maxH && gap >= -maxH;
      if (group.prevEOL || !sameLine || !adjacent) {
        flush();
      }
    }

    if (!group) {
      if (isBlank) continue; // don't open a phrase on leading whitespace
      group = newGroup();
    }

    // Insert a space when runs are visibly separated and no whitespace boundary
    // already exists on either side.
    if (group.parts.length > 0) {
      const maxH = Math.max(group.lastHeight || height, height) || 1;
      const gap = left - group.lastRight;
      if (gap > SPACE_GAP_TOL * maxH && !group.endsWithSpace && !/^\s/.test(raw)) {
        group.parts.push(' ');
      }
    }
    group.parts.push(raw);
    group.endsWithSpace = /\s$/.test(raw);

    if (!isBlank) {
      group.left = Math.min(group.left, left);
      group.right = Math.max(group.right, right);
      group.top = Math.max(group.top, baseline + height);
      group.bottom = Math.min(group.bottom, baseline - DESCENT_RATIO * height);
      group.hasInk = true;
    }
    group.lastRight = right;
    group.lastBaseline = baseline;
    group.lastHeight = height;
    group.prevEOL = Boolean(item.hasEOL);
  }
  flush();
  return phrases;
}

/**
 * Extract phrases + positions for every page of an open PDF document.
 *
 * Always returns one {@link PagePhrases} per page in ascending order (length =
 * `doc.numPages`); pages with no text layer (scanned/image pages) yield
 * `phrases: []` rather than throwing, so a scanned PDF degrades to "no anchors"
 * instead of a crash. A per-page read failure is likewise absorbed as an empty
 * page — the loader (`pdf.ts`) is where a corrupt/non-PDF surfaces as
 * `PdfRenderError`; by the time a document reaches here it has already parsed.
 */
export async function extractPagePhrases(doc: PdfDocument): Promise<PagePhrases[]> {
  const pages: PagePhrases[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    let phrases: Phrase[] = [];
    try {
      const page = await doc.getPage(pageNumber);
      try {
        // Unrotated mediabox in points: [x0, y0, x1, y1]. item.transform lives in
        // this same space, so normalize against it (no viewport/rotation applied).
        const view = page.view;
        const x0 = view[0] ?? 0;
        const y0 = view[1] ?? 0;
        const x1 = view[2] ?? 0;
        const y1 = view[3] ?? 0;
        const content = await page.getTextContent();
        const items = content.items.filter(isTextItem) as unknown as TextItemLike[];
        phrases = phrasesForPage(items, pageNumber, x1 - x0, y1 - y0, x0, y0);
      } finally {
        page.cleanup();
      }
    } catch {
      phrases = [];
    }
    pages.push({ page: pageNumber, phrases });
  }
  return pages;
}
