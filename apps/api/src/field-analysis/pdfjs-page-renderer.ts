import { Injectable, Logger } from '@nestjs/common';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PdfPageRenderer } from './pdf-page-renderer';
import type { VisionPageImage } from '../vision-detection/vision-detection.types';

/**
 * Real {@link PdfPageRenderer} backed by `pdfjs-dist` (legacy Node build) + a
 * native `@napi-rs/canvas` raster backend.
 *
 * This is the concrete binding that lights up the premium Vision path on
 * image-only / scanned PDFs: it rasterizes every page to a PNG {@link
 * VisionPageImage}, which is the *only* input the Vision engine consumes. Swapping
 * it in for `EmptyPdfPageRenderer` is what makes a consent-driven
 * `runPremiumAnalysis` actually call out to Vision instead of degrading to the
 * `unavailable` no-images path.
 *
 * Two things must be exactly right:
 *
 *  1. **Reported dimensions are PDF points (scale 1).** `VisionPageImage.width`/
 *     `.height` carry the page's point size so the normalized (0..1) geometry the
 *     Vision service returns lines up with the heuristic engine's `SignField`
 *     geometry. The *raster* is rendered at {@link RENDER_SCALE}× for legibility,
 *     but that resolution is independent of the reported point dimensions — the
 *     geometry stays normalized, so a higher-res image never shifts field boxes.
 *  2. **Rendering never throws to the caller.** The port contract is: return an
 *     empty array when the document cannot be rasterized. An unreadable/encrypted
 *     PDF yields `[]` (the orchestration reads that as an `unavailable` Vision
 *     path → a safe `failed` stage), and a single un-renderable page is skipped
 *     rather than sinking the whole document.
 */
@Injectable()
export class PdfjsPageRenderer implements PdfPageRenderer {
  private readonly logger = new Logger(PdfjsPageRenderer.name);

  async render(pdf: Buffer): Promise<VisionPageImage[]> {
    let pdfjs: PdfjsModule;
    let canvas: CanvasModule;
    try {
      // Load the canvas backend FIRST so its DOM globals (DOMMatrix / Path2D /
      // ImageData) are installed before pdf.js is imported — pdf.js only reaches
      // for its own (here, unbuilt) `canvas` polyfill when those globals are
      // absent, so seeding them keeps the import clean and quiet.
      canvas = await loadCanvas();
      pdfjs = await loadPdfjs();
    } catch (err) {
      // The renderer or its native backend is not installed/loadable. Treat as an
      // unavailable Vision path rather than crashing the premium run.
      this.logger.warn(`PDF 페이지 렌더러 초기화 실패: ${String(err)}`);
      return [];
    }

    const factory = new NodeCanvasFactory(canvas);
    // `data` must be a fresh Uint8Array pdf.js can take ownership of — a Buffer is
    // a Uint8Array view but pdf.js may detach the underlying buffer, so copy.
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdf),
      canvasFactory: factory,
      // Node has no DOM font/worker fetch; keep pdf.js self-contained and quiet.
      standardFontDataUrl: standardFontsUrl(),
      useSystemFonts: false,
      isEvalSupported: false,
      verbosity: 0, // errors only — silence benign "fake worker"/font notices
    });

    let doc: PdfjsDocument;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      // Unreadable / encrypted / corrupt PDF: no images to send → unavailable.
      this.logger.warn(`PDF 문서를 열 수 없어 렌더를 건너뜀: ${String(err)}`);
      await loadingTask.destroy().catch(() => undefined);
      return [];
    }

    try {
      const pages: VisionPageImage[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const image = await this.renderPage(doc, factory, canvas, pageNumber);
        // Skip a single un-renderable page rather than dropping the whole doc.
        if (image) pages.push(image);
      }
      return pages;
    } finally {
      await doc.cleanup().catch(() => undefined);
      await loadingTask.destroy().catch(() => undefined);
    }
  }

  private async renderPage(
    doc: PdfjsDocument,
    factory: NodeCanvasFactory,
    canvas: CanvasModule,
    pageNumber: number,
  ): Promise<VisionPageImage | null> {
    try {
      const page = await doc.getPage(pageNumber);
      try {
        // scale 1 → the page's point dimensions (the space Vision geometry is
        // normalized against); RENDER_SCALE → the raster we actually encode.
        const pointViewport = page.getViewport({ scale: 1 });
        const rasterViewport = page.getViewport({ scale: RENDER_SCALE });

        const cc = factory.create(rasterViewport.width, rasterViewport.height);
        await page.render({
          canvasContext: cc.context,
          viewport: rasterViewport,
          canvasFactory: factory,
        }).promise;

        const image = cc.canvas.toBuffer('image/png');
        factory.destroy(cc);

        return {
          page: pageNumber,
          width: pointViewport.width,
          height: pointViewport.height,
          mimeType: 'image/png',
          image,
        };
      } finally {
        page.cleanup();
      }
    } catch (err) {
      this.logger.warn(
        `PDF ${pageNumber}쪽 렌더 실패 — 건너뜀: ${String(err)}`,
      );
      return null;
    }
  }
}

/**
 * Raster resolution multiplier over the page's point size. pdf.js measures pages
 * in points (72 pt = 1 inch), so scale 2 ≈ 144 DPI — enough detail for the Vision
 * engine to read field labels on a scanned page without an excessive payload.
 * Only the encoded pixels scale with this; the reported `width`/`height` stay in
 * points, so field geometry (normalized 0..1) is unaffected.
 */
export const RENDER_SCALE = 2;

// --- native canvas factory (pdf.js render backend) ---------------------------

/** A canvas + its 2D context, the pair pdf.js renders into. */
interface CanvasAndContext {
  canvas: NapiCanvas;
  context: unknown;
}

/**
 * The `canvasFactory` pdf.js uses to mint the surfaces it draws onto in Node
 * (there is no DOM `document.createElement('canvas')`). pdf.js creates the main
 * page canvas plus incidental ones (patterns, transparency groups) through this,
 * so the whole render pipeline runs on the native backend.
 */
class NodeCanvasFactory {
  constructor(private readonly canvas: CanvasModule) {}

  create(width: number, height: number): CanvasAndContext {
    const canvas = this.canvas.createCanvas(
      Math.ceil(width),
      Math.ceil(height),
    );
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(cc: CanvasAndContext, width: number, height: number): void {
    cc.canvas.width = Math.ceil(width);
    cc.canvas.height = Math.ceil(height);
  }

  destroy(cc: CanvasAndContext): void {
    // Zero the surface so the native backing store is released promptly.
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

// --- lazy dependency loading (Node-safe, side-effect free until first render) --

/** The subset of a `@napi-rs/canvas` canvas this module uses. */
interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
  toBuffer(mime: 'image/png'): Buffer;
}

/** The subset of the `@napi-rs/canvas` module this module uses. */
interface CanvasModule {
  createCanvas(width: number, height: number): NapiCanvas;
  DOMMatrix?: unknown;
  Path2D?: unknown;
  ImageData?: unknown;
}

/** Minimal shape of the pdf.js pieces this module uses. */
interface PdfjsModule {
  getDocument(src: {
    data: Uint8Array;
    canvasFactory?: unknown;
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

interface PdfjsViewport {
  width: number;
  height: number;
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): PdfjsViewport;
  render(opts: {
    canvasContext: unknown;
    viewport: PdfjsViewport;
    canvasFactory?: unknown;
  }): { promise: Promise<void> };
  cleanup(): void;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;
let canvasPromise: Promise<CanvasModule> | null = null;

/**
 * Lazily load the native `@napi-rs/canvas` backend and install the DOM globals
 * pdf.js references while rasterizing (`DOMMatrix`, `Path2D`, `ImageData`). The
 * backend ships these, so wiring them onto `globalThis` lets pdf.js render in Node
 * without a DOM. Deferred so importing this module stays cheap until a PDF is
 * actually rendered.
 */
function loadCanvas(): Promise<CanvasModule> {
  if (!canvasPromise) {
    canvasPromise = import('@napi-rs/canvas').then((mod) => {
      const canvas = mod as unknown as CanvasModule;
      installCanvasGlobals(canvas);
      return canvas;
    });
  }
  return canvasPromise;
}

/** Load the pdf.js legacy build (deferred, like the text extractor). */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.js') as Promise<
      unknown
    > as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

/** Seed the DOM globals pdf.js needs to rasterize, from the native backend. */
function installCanvasGlobals(canvas: CanvasModule): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix && canvas.DOMMatrix) g.DOMMatrix = canvas.DOMMatrix;
  if (!g.Path2D && canvas.Path2D) g.Path2D = canvas.Path2D;
  if (!g.ImageData && canvas.ImageData) g.ImageData = canvas.ImageData;
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
