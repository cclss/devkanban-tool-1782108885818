/**
 * Browser-side PDF rendering via `pdfjs-dist`.
 *
 * `pdfjs-dist` is a heavy, browser-only module, so it's loaded lazily on first
 * use (never during SSR). The render worker is self-hosted from `/public`
 * (copied from the installed package, so its version always matches the API);
 * this avoids a runtime CDN dependency for the core contract flow.
 *
 * Only first-page preview is needed for the upload step (grain-6). The field
 * placement grain (grain-7) renders all pages — `loadPdf` returns the full
 * document handle so that grain can reuse this loader.
 */

// Loaded lazily; types are import()-only so nothing pdfjs touches SSR runtime.
type PdfjsModule = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Self-hosted worker path (see apps/web/public/pdf.worker.min.mjs). */
const WORKER_SRC = '/pdf.worker.min.mjs';

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      // The worker must exactly match the API version; both come from the same
      // installed package, so the self-hosted copy is guaranteed in sync.
      mod.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return mod;
    });
  }
  return pdfjsPromise;
}

/** Raised when a file can't be parsed as a PDF (corrupt / not a real PDF). */
export class PdfRenderError extends Error {
  constructor(message = 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.') {
    super(message);
    this.name = 'PdfRenderError';
  }
}

/**
 * Parse a PDF from a File. Returns the document handle plus its page count.
 *
 * Reads the bytes fresh from the File each call (a new ArrayBuffer), so the
 * wizard can keep the original File in state and re-render any time without
 * worrying about pdfjs detaching a shared buffer.
 */
export async function loadPdf(file: File): Promise<{ doc: PdfDocument; pageCount: number }> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await pdfjs.getDocument({ data }).promise;
    return { doc, pageCount: doc.numPages };
  } catch {
    throw new PdfRenderError();
  }
}

export interface RenderedSize {
  width: number;
  height: number;
  pageCount: number;
}

/**
 * Render the first page of `file` into `canvas`, fit to `maxWidth` CSS pixels
 * and sharpened for the device pixel ratio. Returns the laid-out CSS size and
 * the document's page count.
 */
export async function renderFirstPage(
  file: File,
  canvas: HTMLCanvasElement,
  maxWidth: number,
): Promise<RenderedSize> {
  const { doc, pageCount } = await loadPdf(file);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = maxWidth / base.width;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const viewport = page.getViewport({ scale: scale * dpr });

    const context = canvas.getContext('2d');
    if (!context) throw new PdfRenderError();

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const cssWidth = viewport.width / dpr;
    const cssHeight = viewport.height / dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    await page.render({ canvasContext: context, viewport }).promise;
    return { width: cssWidth, height: cssHeight, pageCount };
  } catch (err) {
    if (err instanceof PdfRenderError) throw err;
    throw new PdfRenderError();
  } finally {
    // Free worker-side resources; the File stays in wizard state for re-renders.
    void doc.destroy();
  }
}
