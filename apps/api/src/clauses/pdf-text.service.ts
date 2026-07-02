import { Injectable, Logger } from '@nestjs/common';
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.js';

/**
 * One page's extracted text. `page` is the 1-based page number so downstream
 * clause extraction can anchor each clause card to a concrete `sourcePage`.
 */
export interface PdfPageText {
  /** 1-based page number. */
  page: number;
  /** Extracted text for the page (line breaks preserved via `hasEOL`). */
  text: string;
}

/** Outcome of an extraction attempt. */
export type PdfTextStatus = 'TEXT' | 'EMPTY';

/**
 * Why an extraction produced no usable text. Callers treat every `EMPTY` result
 * the same way (fall back to the PDF viewer); the reason is informational only.
 *   • `NON_TEXT`    — parsed fine but the text layer is (near) empty: a scanned /
 *                     image-only PDF, below the character threshold.
 *   • `NO_PAGES`    — the document reports zero pages.
 *   • `PARSE_ERROR` — the bytes could not be parsed (corrupt / not a PDF), or a
 *                     fatal error occurred while walking pages.
 */
export type PdfEmptyReason = 'NON_TEXT' | 'NO_PAGES' | 'PARSE_ERROR';

/**
 * Result of {@link PdfTextService.extract}. On `EMPTY`, `pages` is always `[]`
 * and `reason` explains why — the caller has enough to return an empty clause
 * set so the frontend falls back to the full-document viewer.
 */
export interface PdfTextExtraction {
  status: PdfTextStatus;
  /** Present only when `status === 'EMPTY'`. */
  reason?: PdfEmptyReason;
  /** Per-page text, in page order. Empty when `status === 'EMPTY'`. */
  pages: PdfPageText[];
  /** Total non-whitespace characters extracted across all pages. */
  totalChars: number;
}

export interface PdfTextExtractOptions {
  /**
   * If the total non-whitespace character count across the whole document is
   * below this threshold, the document is classified as non-text and an empty
   * result is returned. Defaults to {@link DEFAULT_NON_TEXT_CHAR_THRESHOLD}.
   */
  nonTextCharThreshold?: number;
}

/**
 * Minimum non-whitespace characters a document must yield to count as a text
 * document. A scanned / image-only PDF yields ~0 characters, while a real
 * contract yields thousands; this floor absorbs stray artifacts (a lone page
 * number, an OCR watermark) without misclassifying an actual contract.
 */
export const DEFAULT_NON_TEXT_CHAR_THRESHOLD = 16;

/**
 * A `getTextContent()` item is either a `TextItem` (carries `str` / `hasEOL`) or
 * a `TextMarkedContent` marker (no text). pdf.js exports these only as typedefs,
 * not runtime members, so we narrow structurally on the presence of `str`.
 */
interface PdfTextItem {
  str: string;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof (item as { str?: unknown }).str === 'string';
}

/** Non-whitespace character count — the unit the non-text threshold compares. */
function countMeaningfulChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * Pure, IO-free utility that extracts per-page text from PDF bytes and decides
 * whether the document actually has a text layer.
 *
 * Deliberately isolated from the `pdf` synthesis module (Korean-font / signed-PDF
 * rendering): this service only *reads* text, so it lives in `clauses`, the home
 * of the AI clause-card pipeline. It never uses `pdf-lib`'s `countPdfPages`.
 *
 * Failure policy: corrupt bytes, non-PDF input, and per-page parse errors are
 * **absorbed into an empty result** — never thrown — so the caller can treat
 * extraction failure, timeout, and non-text documents uniformly (return an empty
 * clause set and let the frontend fall back to the original document).
 */
@Injectable()
export class PdfTextService {
  private readonly logger = new Logger(PdfTextService.name);

  /**
   * Extract per-page text from `pdf`.
   *
   * @returns `{ status: 'TEXT', pages, totalChars }` when the document has a
   *   usable text layer, otherwise `{ status: 'EMPTY', reason, pages: [], … }`.
   *   Never rejects.
   */
  async extract(
    pdf: Uint8Array | Buffer | ArrayBuffer,
    options: PdfTextExtractOptions = {},
  ): Promise<PdfTextExtraction> {
    const threshold =
      options.nonTextCharThreshold ?? DEFAULT_NON_TEXT_CHAR_THRESHOLD;

    let doc: Awaited<ReturnType<typeof getDocument>['promise']>;
    try {
      doc = await getDocument({
        // pdf.js mutates/transfers the backing buffer, so hand it a private copy.
        data: this.toBytes(pdf),
        // Server-side hardening: no eval, no network font fetches, no worker.
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: VerbosityLevel.ERRORS,
      }).promise;
    } catch (err) {
      // Corrupt bytes / not a PDF — absorb as an empty result.
      this.logger.warn(
        `PDF parse failed; treating as empty: ${this.describe(err)}`,
      );
      return this.empty('PARSE_ERROR');
    }

    try {
      const numPages = doc.numPages;
      if (!numPages) {
        return this.empty('NO_PAGES');
      }

      const pages: PdfPageText[] = [];
      let totalChars = 0;

      for (let pageNo = 1; pageNo <= numPages; pageNo++) {
        const text = await this.extractPage(doc, pageNo);
        pages.push({ page: pageNo, text });
        totalChars += countMeaningfulChars(text);
      }

      if (totalChars < threshold) {
        // Scanned / image-only document: no usable text layer.
        return { status: 'EMPTY', reason: 'NON_TEXT', pages: [], totalChars };
      }

      return { status: 'TEXT', pages, totalChars };
    } catch (err) {
      // A fatal error mid-walk still degrades to an empty result.
      this.logger.warn(
        `PDF text walk failed; treating as empty: ${this.describe(err)}`,
      );
      return this.empty('PARSE_ERROR');
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  }

  /**
   * Extract one page's text. A per-page failure is absorbed as empty text for
   * that page rather than aborting the whole document.
   */
  private async extractPage(
    doc: Awaited<ReturnType<typeof getDocument>['promise']>,
    pageNo: number,
  ): Promise<string> {
    let page: Awaited<ReturnType<typeof doc.getPage>> | undefined;
    try {
      page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let out = '';
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        out += item.str;
        if (item.hasEOL) out += '\n';
      }
      return out.trim();
    } catch (err) {
      this.logger.warn(
        `PDF page ${pageNo} text extraction failed; treating page as empty: ${this.describe(
          err,
        )}`,
      );
      return '';
    } finally {
      // Release the page's parsed operator/font state as we stream through.
      page?.cleanup();
    }
  }

  private empty(reason: PdfEmptyReason): PdfTextExtraction {
    return { status: 'EMPTY', reason, pages: [], totalChars: 0 };
  }

  /** Normalize input into a fresh `Uint8Array` pdf.js can own. */
  private toBytes(pdf: Uint8Array | Buffer | ArrayBuffer): Uint8Array {
    if (pdf instanceof ArrayBuffer) return new Uint8Array(pdf.slice(0));
    // Copy so pdf.js's internal transfer never mutates the caller's buffer.
    return Uint8Array.from(pdf);
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  }
}
