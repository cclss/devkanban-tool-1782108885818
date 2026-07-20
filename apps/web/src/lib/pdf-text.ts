/**
 * Per-page text extraction from a selectable-text PDF: what words sit where.
 *
 * The auto-placement step (B안) needs to find anchor phrases ("서명", "날짜",
 * "금액" …) inside a document and drop draft fields next to them. That starts
 * with knowing, for every page, each phrase and its box — expressed in the SAME
 * coordinate system the field model already uses.
 *
 * Coordinate contract: pdfjs `getTextContent()` items carry a `transform`
 * matrix whose `e`/`f` are the run's origin in PDF user space — bottom-left
 * origin, +y UP, points — and `width`/`height` in those same units ("device
 * space" at scale 1). Divide all four by the page's `getViewport({scale:1})`
 * size and you land exactly on `field-geometry.ts`'s {@link NormRect}: a 0..1
 * bottom-left box. So an extracted phrase's `rect` is drop-in compatible with a
 * persisted `SignFieldDto` box — no second coordinate hop.
 *
 * The I/O (`getTextContent` over a live pdfjs document) is split from the pure
 * transform (`itemsToPhrases(items, viewport)`) so the geometry — normalization
 * and same-baseline run merging — is unit-tested against synthetic items with
 * no PDF, no worker, no DOM, exactly like `field-geometry.test.ts`.
 */

import type { PdfDocument } from './pdf';
import type { NormRect } from './field-geometry';

/**
 * The subset of a pdfjs `TextItem` this module reads. pdfjs also interleaves
 * `TextMarkedContent` markers (`{ type }`, no `str`/`transform`) into the item
 * stream; {@link isTextRun} filters those out.
 */
export interface PdfTextRun {
  /** The run's characters (may already include surrounding whitespace). */
  str: string;
  /** 6-element affine matrix `[a, b, c, d, e, f]`; `e`/`f` are the origin. */
  transform: number[];
  /** Advance width of the run, in PDF points (device space at scale 1). */
  width: number;
  /** Glyph height of the run, in PDF points (device space at scale 1). */
  height: number;
  /** pdfjs sets this on the run that ends a visual line. */
  hasEOL?: boolean;
}

/** A pdfjs marked-content marker — carries no geometry, skipped on extraction. */
interface PdfMarkedContent {
  type: string;
}

/** Either kind of entry pdfjs yields in `TextContent.items`. */
export type PdfTextEntry = PdfTextRun | PdfMarkedContent;

/** Page size basis for normalization — a `getViewport({scale:1})` in points. */
export interface ViewportSize {
  width: number;
  height: number;
}

/** One merged phrase and its box, in field-compatible normalized coords. */
export interface Phrase {
  /** The phrase text (adjacent same-line runs joined). */
  text: string;
  /** Bottom-left 0..1 box, identical shape to a persisted field rect. */
  rect: NormRect;
}

/** A page's extracted phrases; `page` is 1-based, matching pdfjs page numbers. */
export interface PagePhrases {
  page: number;
  phrases: Phrase[];
}

/**
 * Merge tuning, all expressed as fractions of the run's own height so they hold
 * across font sizes. Two runs join into one phrase when they share a baseline
 * (vertical origins within {@link BASELINE_TOL_RATIO} of the height) and are
 * horizontally close (the gap between them is at most {@link MERGE_GAP_RATIO} of
 * the height — a word space is a small fraction of the height, a column gutter
 * is several multiples, so this splits columns without splitting words). A space
 * is inserted at the join only when the gap looks like a real word break
 * ({@link SPACE_GAP_RATIO}) and neither side already carries boundary
 * whitespace.
 */
const BASELINE_TOL_RATIO = 0.5;
const MERGE_GAP_RATIO = 1.0;
/** Allow a small negative gap (kerning/overlap) to still count as adjacent. */
const OVERLAP_TOL_RATIO = 0.5;
const SPACE_GAP_RATIO = 0.2;

function isTextRun(entry: PdfTextEntry): entry is PdfTextRun {
  return (
    typeof (entry as PdfTextRun).str === 'string' &&
    Array.isArray((entry as PdfTextRun).transform) &&
    (entry as PdfTextRun).transform.length >= 6
  );
}

/** A phrase under construction, kept in point space until final normalization. */
interface PhraseBuilder {
  text: string;
  /** Run origin (baseline) — bottom edge basis for the normalized box. */
  baseline: number;
  left: number;
  right: number;
  /** Lowest bottom seen (min baseline) across merged runs. */
  bottom: number;
  /** Highest top seen (max baseline + height) across merged runs. */
  top: number;
  height: number;
  /** The last merged run ended a visual line — forces a break before the next. */
  endsLine: boolean;
}

function startBuilder(run: PdfTextRun): PhraseBuilder {
  const x = run.transform[4] ?? 0;
  const y = run.transform[5] ?? 0;
  return {
    text: run.str,
    baseline: y,
    left: x,
    right: x + run.width,
    bottom: y,
    top: y + run.height,
    height: run.height,
    endsLine: run.hasEOL === true,
  };
}

/** Whether `run` continues `b`'s phrase (same baseline, horizontally adjacent). */
function canMerge(b: PhraseBuilder, run: PdfTextRun): boolean {
  if (b.endsLine) return false;
  const x = run.transform[4] ?? 0;
  const y = run.transform[5] ?? 0;
  const ref = Math.max(b.height, run.height) || 1;
  if (Math.abs(y - b.baseline) > ref * BASELINE_TOL_RATIO) return false;
  const gap = x - b.right;
  return gap <= ref * MERGE_GAP_RATIO && gap >= -ref * OVERLAP_TOL_RATIO;
}

function mergeInto(b: PhraseBuilder, run: PdfTextRun): void {
  const x = run.transform[4] ?? 0;
  const y = run.transform[5] ?? 0;
  const gap = x - b.right;
  const ref = Math.max(b.height, run.height) || 1;
  const needsSpace =
    gap > ref * SPACE_GAP_RATIO && !/\s$/.test(b.text) && !/^\s/.test(run.str);
  b.text += (needsSpace ? ' ' : '') + run.str;
  b.left = Math.min(b.left, x);
  b.right = Math.max(b.right, x + run.width);
  b.bottom = Math.min(b.bottom, y);
  b.top = Math.max(b.top, y + run.height);
  b.height = Math.max(b.height, run.height);
  if (run.hasEOL === true) b.endsLine = true;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Finalize a builder into a normalized phrase; `null` if it collapsed to empty. */
function finishBuilder(b: PhraseBuilder, viewport: ViewportSize): Phrase | null {
  const text = b.text.trim();
  if (text.length === 0) return null;
  const vw = viewport.width || 1;
  const vh = viewport.height || 1;
  const x = clamp01(b.left / vw);
  const y = clamp01(b.bottom / vh);
  return {
    text,
    rect: {
      x,
      y,
      width: clamp01(b.right / vw - x),
      height: clamp01(b.top / vh - y),
    },
  };
}

/**
 * Pure transform: pdfjs text entries → field-compatible phrases.
 *
 * Walks the entries in reading order, growing one phrase while successive runs
 * stay on the same baseline and close enough to be the same line, breaking to a
 * new phrase otherwise. Marked-content markers and whitespace-only runs don't
 * start a phrase, but a whitespace run that ends a line still forces a break.
 * DOM-free and deterministic — unit-tested with synthetic items.
 */
export function itemsToPhrases(
  entries: readonly PdfTextEntry[],
  viewport: ViewportSize,
): Phrase[] {
  const phrases: Phrase[] = [];
  let current: PhraseBuilder | null = null;

  const flush = () => {
    if (current) {
      const phrase = finishBuilder(current, viewport);
      if (phrase) phrases.push(phrase);
      current = null;
    }
  };

  for (const entry of entries) {
    if (!isTextRun(entry)) continue;

    // Whitespace-only runs carry no glyphs, but pdfjs uses them (often with
    // hasEOL) to mark spacing/line ends — honor the break, don't start a phrase.
    if (entry.str.trim().length === 0) {
      if (entry.hasEOL === true && current) current.endsLine = true;
      continue;
    }

    if (current && canMerge(current, entry)) {
      mergeInto(current, entry);
    } else {
      flush();
      current = startBuilder(entry);
    }
  }
  flush();

  return phrases;
}

/**
 * Extract every page's phrases + boxes from an open pdfjs document.
 *
 * The I/O half: pulls each page's text content and its scale-1 viewport, then
 * defers to the pure {@link itemsToPhrases}. Returns pages in order (1-based),
 * each with its normalized phrases. Pages with no selectable text yield an empty
 * `phrases` array rather than being dropped, so callers see the full page set.
 */
export async function extractPagePhrases(doc: PdfDocument): Promise<PagePhrases[]> {
  const pages: PagePhrases[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const phrases = itemsToPhrases(content.items as PdfTextEntry[], {
        width: viewport.width,
        height: viewport.height,
      });
      pages.push({ page: pageNumber, phrases });
    } finally {
      page.cleanup();
    }
  }
  return pages;
}
