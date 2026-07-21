import { Injectable, Logger } from '@nestjs/common';
import type { PageText } from './clause-extraction';

/**
 * Server-side PDF text extraction for contract-highlight summarization (grain-5).
 *
 * `pdfjs-dist` (same version the web renderer self-hosts, so behaviour matches)
 * is the only dependency able to pull real Unicode text out of a PDF — `pdf-lib`
 * writes PDFs but can't read their text content. It's a heavy, ESM-only module,
 * so it's loaded lazily on first use and never during module init.
 *
 * Extraction is strictly best-effort: a scanned/image-only PDF, a CID font
 * without a ToUnicode map, or a parse failure yields `[]` rather than throwing.
 * The caller degrades to an "available: false" summary — the signer always still
 * has the full document, so a missing summary is never a hard error.
 *
 * Injectable so the highlight flow can be unit-tested with a fake extractor and
 * never has to load pdfjs in jest.
 */
@Injectable()
export class PdfTextService {
  private readonly logger = new Logger(PdfTextService.name);

  /**
   * How the pdfjs module is loaded. Defaults to a native dynamic import of the
   * ESM-only legacy build; overridable in tests (jest's VM can't `import()` ESM
   * without `--experimental-vm-modules`, so specs assign a fake module). Kept a
   * plain property — not a constructor param — so Nest DI needs nothing to
   * construct the service.
   */
  loadModule: () => Promise<PdfjsModule> = loadPdfjs;

  /**
   * Extract per-page text from raw PDF bytes. Returns one {@link PageText} per
   * page (empty pages included so page numbers stay 1:1 with the document).
   * Never throws — returns `[]` on any failure.
   */
  async extract(bytes: Buffer): Promise<PageText[]> {
    try {
      const pdfjs = await this.loadModule();
      // `data` must be a Uint8Array pdfjs can take ownership of; copy so we never
      // hand it a Buffer view over a pooled allocation.
      const data = new Uint8Array(bytes);
      const doc = await pdfjs.getDocument({
        data,
        // No worker thread / eval / network font fetches on the server.
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: false,
        verbosity: 0,
      }).promise;

      const pages: PageText[] = [];
      try {
        for (let page = 1; page <= doc.numPages; page++) {
          const p = await doc.getPage(page);
          const content = await p.getTextContent();
          const text = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
          pages.push({ page, text });
          // Release page resources as we go for large documents.
          p.cleanup();
        }
      } finally {
        await doc.destroy();
      }
      return pages;
    } catch (err) {
      this.logger.warn(
        `PDF text extraction failed; returning no highlights: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}

// --- lazy pdfjs loader ------------------------------------------------------

/** Minimal structural types for the pdfjs surface we use (avoids a hard dep on
 *  pdfjs types under CommonJS moduleResolution). */
interface PdfjsTextItem {
  str?: string;
}
interface PdfjsPage {
  getTextContent(): Promise<{ items: PdfjsTextItem[] }>;
  cleanup(): void;
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(src: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
    verbosity?: number;
  }): { promise: Promise<PdfjsDocument> };
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Import the ESM-only pdfjs legacy (Node) build without the TS CommonJS target
 * downleveling `import()` into a `require()` (which cannot load an `.mjs`). The
 * `Function` indirection keeps a *native* dynamic import at runtime.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    const nativeImport = new Function('m', 'return import(m)') as (
      m: string,
    ) => Promise<PdfjsModule>;
    pdfjsPromise = nativeImport('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}
