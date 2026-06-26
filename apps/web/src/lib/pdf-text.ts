/**
 * PDF text extraction for the AI sign-field suggester.
 *
 * This is the *extractor* half of the pipeline: it turns a parsed PDF into the
 * normalized {@link TextToken}s that the framework-free placement engine
 * (`signfield-suggest.ts`, grain-1) consumes. Its only job is the pdfjs
 * integration + coordinate math — classification and placement stay in the
 * engine.
 *
 * Coordinate bridge (the whole reason this file is careful):
 *   • pdfjs `getTextContent()` yields each glyph run with a `transform` matrix in
 *     PDF user space (bottom-left origin, y UP) and a `width`/`height` already in
 *     device space of the scale-1 viewport.
 *   • The engine + persisted field model want a {@link NormRect}: bottom-left
 *     origin, 0..1 of the page. Identical axis convention, just normalized.
 *   • We compose `viewport.transform × item.transform` (the standard pdfjs text-
 *     layer math) so page rotation/flip is handled generically, take the device-
 *     space baseline origin, then divide by the page's device size and flip back
 *     to a y-up normalized box.
 *
 * The pure pieces ({@link textItemToToken}) take plain `{ transform, width,
 * height }` fixtures, so the normalization is unit-tested without ever booting
 * pdfjs. {@link extractTextTokens} is the thin async wrapper that walks a real
 * (or fake) document page by page — sequentially, so a 20MB multi-page upload
 * never holds more than one page's text content in memory at once.
 */

import { type NormRect, clampNormRect } from './field-geometry';
import { type TextToken } from './signfield-suggest';

/**
 * The subset of a pdfjs `TextItem` we depend on. A real `TextItem` is structurally
 * assignable to this; `TextMarkedContent` (which lacks `str`) is not, and is
 * filtered out by {@link isTextItem}.
 */
export interface TextItemLike {
  /** The glyph run's text. */
  str: string;
  /** 6-element affine matrix `[a,b,c,d,e,f]` mapping text → PDF user space. */
  transform: number[];
  /** Run width in device space (scale-1 viewport units). */
  width: number;
  /** Run height in device space (scale-1 viewport units). */
  height: number;
}

/**
 * The subset of a pdfjs `PageViewport` we depend on. Build it at `scale: 1` so
 * `width`/`height` are the page's device size and `TextItem` dims need no extra
 * scaling. A real `PageViewport` is structurally assignable to this.
 */
export interface ViewportLike {
  width: number;
  height: number;
  /** Maps PDF user space → device space (top-left origin, y DOWN). */
  transform: number[];
}

/** The page surface the extractor uses — a real pdfjs `PDFPageProxy` satisfies it. */
export interface PdfPageLike {
  getViewport(params: { scale: number }): ViewportLike;
  getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
  /** Optional: release page resources after extraction (pdfjs has it). */
  cleanup?: () => void;
}

/** The document surface the extractor uses — a real pdfjs `PdfDocument` satisfies it. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/** Result of walking a whole document's text layer. */
export interface ExtractResult {
  /** Every recoverable, non-blank text token, normalized to page-relative bbox. */
  tokens: TextToken[];
  /** Page count actually walked. */
  pageCount: number;
  /**
   * Whether the document exposed *any* text item at all. `false` means a scanned
   * / image-only PDF — the caller reports "no text found" rather than "no
   * anchors", since the two are different user situations.
   */
  hadTextLayer: boolean;
}

/** Per-page progress signal (1-based page over total). */
export type ExtractProgress = (page: number, pageCount: number) => void;

type Mat6 = [number, number, number, number, number, number];

/** Validate a transform array into a finite 6-tuple, or null. */
function asMatrix(m: readonly number[] | undefined): Mat6 | null {
  if (!Array.isArray(m) || m.length < 6) return null;
  const out: Mat6 = [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!];
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

/** Affine matrix product, matching pdfjs `Util.transform(m1, m2)`. */
function multiply(a: Mat6, b: Mat6): Mat6 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Clamp one coordinate component into the unit interval. */
function unit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Narrow a `getTextContent` item to a usable text run (drops `TextMarkedContent`). */
function isTextItem(item: unknown): item is TextItemLike {
  if (typeof item !== 'object' || item === null) return false;
  const it = item as { str?: unknown; transform?: unknown };
  return typeof it.str === 'string' && Array.isArray(it.transform);
}

/**
 * Convert one pdfjs text item into a normalized {@link TextToken}, or null if it
 * is blank or its geometry is unusable.
 *
 * The math: compose `viewport.transform × item.transform` to land the run's
 * baseline-left origin in device space (top-left origin). The run's box rises
 * `height` above that baseline, so its device top is `baselineY - height` and its
 * bottom is `baselineY`. Normalizing and flipping the y-axis back to bottom-left
 * gives the lower-left corner at `(originX/W, (H - baselineY)/H)`.
 */
export function textItemToToken(
  item: TextItemLike,
  viewport: ViewportLike,
  page: number,
): TextToken | null {
  const text = typeof item.str === 'string' ? item.str : '';
  if (text.trim().length === 0) return null;

  const m = asMatrix(item.transform);
  const vt = asMatrix(viewport.transform);
  if (!m || !vt) return null;

  const W = viewport.width;
  const H = viewport.height;
  if (!(W > 0) || !(H > 0)) return null;

  const combined = multiply(vt, m);
  const originX = combined[4];
  const baselineY = combined[5];
  const widthDev = Math.abs(item.width);
  // Fall back to the matrix's vertical scale if the item omits a height.
  const heightDev =
    Math.abs(item.height) || Math.hypot(combined[2], combined[3]);
  if (
    !Number.isFinite(originX) ||
    !Number.isFinite(baselineY) ||
    !Number.isFinite(widthDev) ||
    !Number.isFinite(heightDev)
  ) {
    return null;
  }

  const rect: NormRect = {
    x: unit(originX / W),
    y: unit((H - baselineY) / H),
    width: unit(widthDev / W),
    height: unit(heightDev / H),
  };
  if (rect.width <= 0 || rect.height <= 0) return null;

  // Final guard so every token is a valid in-page box; the engine re-clamps too,
  // but keeping the contract here means a token is never half-off the page.
  return { text, page, rect: clampNormRect(rect) };
}

/**
 * Walk every page of `doc`, normalizing its text layer into {@link TextToken}s.
 *
 * Pages are processed strictly one at a time (`await` per page, `cleanup()`
 * after) so a large multi-page document never materializes more than a single
 * page's worth of text content — the memory-safety boundary for 20MB uploads.
 *
 * Never throws on an empty text layer: a scanned PDF simply yields `tokens: []`
 * with `hadTextLayer: false`.
 */
export async function extractTextTokens(
  doc: PdfDocumentLike,
  onProgress?: ExtractProgress,
): Promise<ExtractResult> {
  const pageCount = Math.max(0, Math.floor(doc.numPages) || 0);
  const tokens: TextToken[] = [];
  let hadTextLayer = false;

  for (let p = 1; p <= pageCount; p++) {
    const pageProxy = await doc.getPage(p);
    try {
      const viewport = pageProxy.getViewport({ scale: 1 });
      const content = await pageProxy.getTextContent();
      for (const raw of content.items) {
        if (!isTextItem(raw)) continue;
        // Any text item — even a whitespace run — proves a text layer exists.
        hadTextLayer = true;
        const token = textItemToToken(raw, viewport, p);
        if (token) tokens.push(token);
      }
    } finally {
      pageProxy.cleanup?.();
    }
    onProgress?.(p, pageCount);
  }

  return { tokens, pageCount, hadTextLayer };
}
