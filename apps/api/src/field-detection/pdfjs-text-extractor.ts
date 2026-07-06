import { Injectable, Logger } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PdfTextExtractor } from './pdf-text-extractor';
import type {
  PdfPageText,
  PdfTextLayer,
  TextToken,
} from './field-detection.types';

/**
 * Real positioned-text extractor backed by `pdfjs-dist` (legacy Node build).
 *
 * It turns a PDF's bytes into the {@link PdfTextLayer} the heuristic detector
 * consumes: every page's positioned text runs plus the page's point dimensions.
 * This is the concrete binding for the {@link PdfTextExtractor} port — swapping
 * it in for `EmptyPdfTextExtractor` is what makes the default (heuristic) engine
 * actually place fields on a text PDF.
 *
 * Coordinate contract (the one thing that must be exactly right): pdf.js reports
 * each run through a text matrix in the page's *visible* space once the page
 * viewport transform is applied — a **top-left** origin (y grows downward), the
 * way a reader sees the page. {@link TextToken} (and the whole downstream field
 * geometry) is **bottom-left** origin in PDF points. {@link mapTextItem} performs
 * that top-left → bottom-left flip and the point mapping; it is pure and unit
 * tested in isolation, with no pdf.js dependency.
 *
 * Degradation: a page with no text layer (scanned / image-only) yields an empty
 * `tokens` array rather than an error, and an unreadable document surfaces as an
 * empty layer — the service's `no-text` fallback contract. Extraction never
 * throws to the caller.
 */
@Injectable()
export class PdfjsTextExtractor implements PdfTextExtractor {
  private readonly logger = new Logger(PdfjsTextExtractor.name);

  async extract(pdf: Buffer): Promise<PdfTextLayer> {
    const pdfjs = await loadPdfjs();

    // `data` must be a fresh Uint8Array pdf.js can take ownership of — a Buffer
    // is a Uint8Array view but pdf.js may detach the underlying buffer, so copy.
    const data = new Uint8Array(pdf);
    const loadingTask = pdfjs.getDocument({
      data,
      // Node has no DOM font/worker fetch; keep pdf.js self-contained and quiet.
      standardFontDataUrl: standardFontsUrl(),
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: 0, // errors only — silence benign "fake worker"/font notices
    });

    const doc = await loadingTask.promise;
    try {
      const pages: PdfPageText[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        pages.push(await this.extractPage(doc, pageNumber));
      }
      return { pages };
    } finally {
      // Free the parsed document; ignore teardown errors.
      await doc.cleanup().catch(() => undefined);
      await loadingTask.destroy().catch(() => undefined);
    }
  }

  private async extractPage(
    doc: PdfjsDocument,
    pageNumber: number,
  ): Promise<PdfPageText> {
    const page = await doc.getPage(pageNumber);
    // scale 1 → points; the viewport is the *visible* (rotation-applied) page,
    // matching the normalized space SignField geometry uses.
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const tokens: TextToken[] = [];
    for (const item of content.items) {
      if (!isTextItem(item)) continue; // skip marked-content markers
      const token = mapTextItem(item, viewport, pageNumber);
      if (token) tokens.push(token);
    }

    page.cleanup();
    return {
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      tokens,
    };
  }
}

// --- pure coordinate mapping (no pdf.js dependency; unit tested) --------------

/** A 2×3 affine matrix `[a, b, c, d, e, f]`, pdf.js' transform convention. */
export type Matrix = [number, number, number, number, number, number];

/** The subset of a pdf.js text item {@link mapTextItem} needs. */
export interface TextItemLike {
  /** The run's text (may include surrounding whitespace). */
  str: string;
  /** Text-space → page transform `[a, b, c, d, e, f]` (baseline origin). */
  transform: number[];
  /** Advance width of the run, in text-space points. */
  width: number;
  /** Font height of the run, in text-space points. */
  height: number;
}

/** The subset of a pdf.js viewport {@link mapTextItem} needs. */
export interface ViewportLike {
  /** Visible page width, in points. */
  width: number;
  /** Visible page height, in points. */
  height: number;
  /** Page → visible-device transform (top-left origin, y downward). */
  transform: number[];
}

/**
 * Compose two affine matrices the way pdf.js' `Util.transform(m, n)` does:
 * apply `n` first, then `m`. Used to map a text item's baseline transform into
 * the page's visible-device space via the viewport transform.
 */
export function multiplyMatrix(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * Map one pdf.js text run to a bottom-left-origin {@link TextToken}, or `null`
 * for an empty/whitespace-only run.
 *
 * The item transform places the run's baseline in text space; composing it with
 * the viewport transform yields the baseline in visible-device space (top-left
 * origin, y downward). The glyph box sits one font-height above the baseline, so
 * in bottom-left space its lower edge is `pageHeight - deviceBaselineY`. Width
 * and height are rotation-invariant magnitudes (a page's `/Rotate` swaps the
 * viewport axes but not a run's advance/height), so they read straight off the
 * item.
 */
export function mapTextItem(
  item: TextItemLike,
  viewport: ViewportLike,
  page: number,
): TextToken | null {
  const text = (item.str ?? '').trim();
  if (!text) return null;

  const device = multiplyMatrix(
    viewport.transform as Matrix,
    item.transform as Matrix,
  );

  const fontHeight = Math.hypot(device[2], device[3]);
  const height = fontHeight > 0 ? fontHeight : Math.abs(item.height);
  const width = Math.abs(item.width);

  // device[4]/device[5] = baseline origin in visible top-left space.
  const x = device[4];
  const y = viewport.height - device[5]; // top-left → bottom-left flip

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { text, page, x, y, width, height };
}

// --- pdf.js loading (lazy, Node-safe) ----------------------------------------

/** Minimal shape of the pdf.js pieces this module uses. */
interface PdfjsModule {
  getDocument(src: {
    data: Uint8Array;
    standardFontDataUrl?: string;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfjsDocument>; destroy(): Promise<void> };
}

interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  cleanup(): Promise<void>;
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): ViewportLike;
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Lazily load the pdf.js legacy build. In Node pdf.js tries to `require('canvas')`
 * to polyfill `DOMMatrix`/`Path2D` for *rendering*; text extraction never touches
 * them, so we pre-install inert globals to skip that (optional, native) dependency
 * and its load-time warning. Loading is deferred so importing this module stays
 * cheap and side-effect free until a PDF is actually analysed.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    installPdfjsGlobals();
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.js') as Promise<
      unknown
    > as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

/** Pre-seed inert `DOMMatrix`/`Path2D` so pdf.js skips the optional canvas dep. */
function installPdfjsGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) g.DOMMatrix = class DOMMatrix {};
  if (!g.Path2D) g.Path2D = class Path2D {};
}

/** File URL of pdf.js' bundled standard fonts, or `undefined` if unresolved. */
function standardFontsUrl(): string | undefined {
  try {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.js');
    const dir = join(dirname(entry), '..', '..', 'standard_fonts/');
    return pathToFileURL(dir).href;
  } catch {
    return undefined;
  }
}

/** A pdf.js text item carries a `str` + `transform`; markers do not. */
function isTextItem(item: unknown): item is TextItemLike {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { str?: unknown }).str === 'string' &&
    Array.isArray((item as { transform?: unknown }).transform)
  );
}
