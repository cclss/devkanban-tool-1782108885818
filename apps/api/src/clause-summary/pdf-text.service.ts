import { Injectable, Logger } from '@nestjs/common';

/** Per-page extracted text plus the document's page count. */
export interface ExtractedPdfText {
  /** Plain text of each page, index 0 = page 1. */
  pages: string[];
  /** Total pages in the source PDF. */
  pageCount: number;
}

/**
 * Extracts plain text from a PDF's bytes for downstream AI summarization.
 *
 * Uses `unpdf` (a serverless-friendly `pdfjs` wrapper, no native deps) via a
 * dynamic import so the ESM-only package loads cleanly from this CommonJS Nest
 * build — and so nothing is pulled in unless a summary is actually generated.
 *
 * Boundary: text extraction only. Scanned/image-only PDFs (which yield no text)
 * are out of scope for this grain — OCR is a separate concern. Such a PDF
 * returns empty page text; the caller then no-ops (no summary), which is the
 * defined graceful fallback.
 */
@Injectable()
export class PdfTextService {
  private readonly logger = new Logger(PdfTextService.name);

  async extract(pdf: Buffer): Promise<ExtractedPdfText> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unpdf: any = await import('unpdf');
    const doc = await unpdf.getDocumentProxy(new Uint8Array(pdf));
    const { totalPages, text } = await unpdf.extractText(doc, { mergePages: false });

    const pages: string[] = Array.isArray(text)
      ? text.map((p: unknown) => (typeof p === 'string' ? p : ''))
      : [typeof text === 'string' ? text : ''];

    const pageCount = typeof totalPages === 'number' && totalPages > 0 ? totalPages : pages.length;

    return { pages, pageCount };
  }
}
