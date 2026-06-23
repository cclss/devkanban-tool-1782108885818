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
 *
 * The signer never holds a File (the document lives server-side behind a session
 * token), so `loadPdfFromData` / `loadPdfFromUrl` open a document from fetched
 * bytes or an authenticated URL — the same handle shape every renderer consumes.
 */

// Loaded lazily; types are import()-only so nothing pdfjs touches SSR runtime.
type PdfjsModule = typeof import('pdfjs-dist');
export type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;
type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']>;

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
  return loadPdfFromData(await file.arrayBuffer());
}

/**
 * Open a PDF from raw bytes. The shared core behind every loader: the upload
 * preview reads a File's buffer, the signer fetches bytes over the wire, and
 * both end here. Returns the document handle plus its page count.
 */
export async function loadPdfFromData(
  data: ArrayBuffer | Uint8Array,
): Promise<{ doc: PdfDocument; pageCount: number }> {
  const pdfjs = await getPdfjs();
  // pdfjs may detach the underlying buffer; every caller passes a freshly read
  // buffer (File.arrayBuffer / Response.arrayBuffer), so a view is safe here.
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  try {
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    return { doc, pageCount: doc.numPages };
  } catch {
    throw new PdfRenderError();
  }
}

/**
 * Open a PDF served from `url`. Used by the signer, whose document is streamed
 * from a session-guarded endpoint — pass the bearer header via `init`. Any
 * fetch/parse failure surfaces as a {@link PdfRenderError} so the viewer shows
 * the same friendly guard as a corrupt file.
 */
export async function loadPdfFromUrl(
  url: string,
  init?: RequestInit,
): Promise<{ doc: PdfDocument; pageCount: number }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new PdfRenderError();
  }
  if (!res.ok) throw new PdfRenderError();
  return loadPdfFromData(await res.arrayBuffer());
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

// --- Multi-page rendering (field placement, grain-7) -----------------------

/**
 * Open a PDF once and keep the handle for repeated page renders.
 *
 * The field-placement step renders pages on demand (page switch, zoom) against a
 * single long-lived document, unlike the upload preview which renders page 1 and
 * disposes. Caller is responsible for `doc.destroy()` on unmount.
 */
export async function openPdf(file: File): Promise<{ doc: PdfDocument; pageCount: number }> {
  return loadPdf(file);
}

/** A rendered page's laid-out CSS size (the field overlay's coordinate basis). */
export interface RenderedPage {
  cssWidth: number;
  cssHeight: number;
}

// Track the in-flight render per canvas so a fast page/zoom change cancels the
// previous one — pdfjs throws if two render() calls touch the same canvas.
const activeRenders = new WeakMap<HTMLCanvasElement, RenderTask>();

/** Thrown render was superseded by a newer one; callers ignore it silently. */
export function isRenderCancelled(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'RenderingCancelledException'
  );
}

/**
 * Render `pageNumber` of an open document into `canvas`, fit to `cssWidth` CSS
 * pixels at the device pixel ratio. Cancels any prior render on the same canvas
 * first. Returns the laid-out CSS size used to place the field overlay.
 */
export async function renderPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<RenderedPage> {
  activeRenders.get(canvas)?.cancel();

  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const viewport = page.getViewport({ scale: scale * dpr });

  const context = canvas.getContext('2d');
  if (!context) throw new PdfRenderError();

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const cssHeight = viewport.height / dpr;
  const laidOutWidth = viewport.width / dpr;
  canvas.style.width = `${laidOutWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const task = page.render({ canvasContext: context, viewport });
  activeRenders.set(canvas, task);
  try {
    await task.promise;
    return { cssWidth: laidOutWidth, cssHeight };
  } catch (err) {
    if (isRenderCancelled(err)) throw err;
    throw new PdfRenderError();
  } finally {
    if (activeRenders.get(canvas) === task) activeRenders.delete(canvas);
    page.cleanup();
  }
}
