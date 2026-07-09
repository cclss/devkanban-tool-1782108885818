/**
 * PDF text-layer extraction for the text-heuristic field-suggestion engine.
 *
 * Given the raw bytes of a PDF, this pulls every text fragment out of the
 * document's text layer together with its page-space bounding box and each
 * page's size. The anchor matcher / box-placement (grain-3) consumes this to
 * find keyword anchors and derive draft field boxes.
 *
 * ## Purity & privacy boundary
 * This function is **pure and side-effect free**: input is the PDF bytes, output
 * is the extracted geometry. It performs **no file-system and no network** access
 * — pdf.js runs in-process (its Node "fake worker" on the main thread) and is
 * configured to never fetch fonts or touch system fonts. This upholds the spec's
 * hard constraint that document data never leaves the `apps/api` process
 * (외부로 문서 데이터 전송 금지).
 *
 * ## Coordinate system (read this before normalizing in grain-3)
 * Every coordinate here — page `width`/`height` and each fragment `bbox` — is in
 * **PDF page space: bottom-left origin, +x right, +y UP, in points, relative to
 * the page's *unrotated* media box.** This is the exact same origin convention as
 * the normalized (0..1) sign-field contract owned by `@repo/field-geometry`
 * (bottom-left origin), so a fragment box normalizes with **no axis flip**:
 *
 *     nx = bbox.x / page.width      ny = bbox.y / page.height
 *     nw = bbox.width / page.width  nh = bbox.height / page.height
 *
 * A fragment's `bbox` lower-left corner is the text run's baseline start
 * (`x = transform[4]`, `y = transform[5]` of the pdf.js text item); `width`/
 * `height` are the run's device-space extent (`height` ≈ the glyph box / font
 * size). Descent below the baseline is treated as negligible, so the box is a
 * close, slightly-high approximation of the visible glyph run — more than enough
 * to anchor a field beside or below the text.
 *
 * ## Page rotation
 * pdf.js reports text-item coordinates in the **unrotated media-box** space
 * regardless of the page `/Rotate`, so `width`/`height` here are the media-box
 * size (not the viewer-visible, rotation-applied size) to keep fragments and the
 * page basis in one space. Each page also carries its `rotation` (0/90/180/270)
 * so a downstream consumer can reconcile with the viewer-visible page if needed.
 * Contract PDFs are overwhelmingly unrotated, where media-box space and the
 * visible page coincide.
 *
 * ## No text layer (scanned images)
 * A scanned/image-only PDF has no text layer, so every page yields zero
 * fragments and {@link PdfTextLayer.hasTextLayer} is `false`. The engine turns
 * that into an empty `SignFieldDto[]` (manual-placement fallback) — OCR is out of
 * scope.
 */

/** A rect in PDF page space: bottom-left origin, points, relative to the page. */
export interface PageRect {
  /** Lower-left x, in points from the page's left edge. */
  x: number;
  /** Lower-left y, in points from the page's bottom edge (y grows upward). */
  y: number;
  /** Width in points. */
  width: number;
  /** Height in points. */
  height: number;
}

/** One text run extracted from a page's text layer. */
export interface PdfTextFragment {
  /** The run's text, end-trimmed and never empty/whitespace-only. */
  text: string;
  /** The run's bounding box in page space (bottom-left origin, points). */
  bbox: PageRect;
}

/** All text extracted from a single page, plus the page's basis geometry. */
export interface PdfPageText {
  /** 1-based page number. */
  page: number;
  /** Unrotated media-box width, in points. */
  width: number;
  /** Unrotated media-box height, in points. */
  height: number;
  /** Page `/Rotate` in degrees (0 | 90 | 180 | 270). */
  rotation: number;
  /** Text runs on this page (empty for a page with no text layer). */
  fragments: PdfTextFragment[];
}

/** The full text layer of a PDF, one entry per page. */
export interface PdfTextLayer {
  /** One entry per page, in document order. */
  pages: PdfPageText[];
  /** `true` iff at least one text fragment was found across all pages. */
  hasTextLayer: boolean;
}

// pdf.js 4.x ships as ESM only. This module is compiled to CommonJS (Nest /
// ts-jest), where a plain `import()` would be downleveled to `require()` and
// fail on an ESM package. Loading through a `Function`-built dynamic import
// keeps a *real* `import()` at runtime regardless of the compile target. The
// type is pinned to the package's public types for a fully typed surface.
type PdfjsModule = typeof import('pdfjs-dist');
const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<PdfjsModule>;

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Load pdf.js once (legacy build = Node-friendly), memoized for the process. */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * Extract the text layer (fragments + bounding boxes) and page sizes from a PDF.
 *
 * Pure and IO-free (see the module header). Returns one {@link PdfPageText} per
 * page in document order; a page with no text layer has an empty `fragments`
 * array. `hasTextLayer` is a convenience flag summarizing whether any text was
 * found at all.
 *
 * @param data Raw PDF bytes. The buffer is copied before parsing, so the
 *   caller's buffer is never mutated or detached.
 * @throws If the bytes are not a parseable PDF (a *valid* image-only PDF is not
 *   an error — it simply yields empty fragments).
 */
export async function extractPdfTextLayer(data: Buffer | Uint8Array): Promise<PdfTextLayer> {
  const pdfjs = await loadPdfjs();

  // Copy into a fresh Uint8Array: pdf.js may transfer/detach the backing buffer,
  // and we must not mutate the caller's bytes.
  const bytes = new Uint8Array(data);

  const doc = await pdfjs.getDocument({
    data: bytes,
    // In-process, hermetic, safe: no eval, no font fetching, no system-font
    // (file-system) probing. Keeps the privacy/no-IO boundary intact.
    isEvalSupported: false,
    useSystemFonts: false,
    // Errors only — silence pdf.js's font/worker warnings in server logs.
    verbosity: 0,
  }).promise;

  try {
    const pages: PdfPageText[] = [];
    let hasTextLayer = false;

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        // rotation:0 viewport = unrotated media box, the space the text-item
        // transforms live in (see module header on rotation).
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        const content = await page.getTextContent();

        const fragments: PdfTextFragment[] = [];
        for (const item of content.items) {
          // Text-marked-content markers have no `str`; skip them.
          if (!('str' in item)) continue;

          const text = item.str.trim();
          if (text.length === 0) continue; // whitespace-only runs carry no anchor

          const transform = item.transform as number[];
          const x = transform[4] ?? 0; // baseline start x (bottom-left origin)
          const y = transform[5] ?? 0; // baseline start y (bottom-left origin)

          fragments.push({
            text,
            bbox: { x, y, width: item.width, height: item.height },
          });
        }

        if (fragments.length > 0) hasTextLayer = true;

        pages.push({
          page: pageNumber,
          width: viewport.width,
          height: viewport.height,
          rotation: normalizeQuarterTurn(page.rotate),
          fragments,
        });
      } finally {
        page.cleanup();
      }
    }

    return { pages, hasTextLayer };
  } finally {
    // Release worker-side resources; the function holds no handle afterward.
    await doc.destroy();
  }
}

/** Snap an arbitrary page-rotation angle to `0 | 90 | 180 | 270`. */
function normalizeQuarterTurn(angle: number): number {
  const snapped = Math.round((angle || 0) / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}
