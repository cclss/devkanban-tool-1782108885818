import { Inject, Injectable, Logger } from '@nestjs/common';
import { selectClauses } from './clause-heuristics';
import {
  PDF_TEXT_EXTRACTOR,
  type ExtractedClause,
  type PdfTextExtractor,
} from './clause-extraction.types';

/**
 * Extracts the top 1–5 "핵심 조항" cards from a contract PDF for the signer
 * screen (grain-1).
 *
 * It orchestrates two halves and owns neither's internals:
 *   • a {@link PdfTextExtractor} (injected, `pdfjs-dist` behind the boundary)
 *     turns bytes into per-page text;
 *   • the pure `selectClauses` heuristic turns that text into cards.
 *
 * Failure policy mirrors the spec: if extraction throws (corrupt / image-only
 * PDF) or yields no usable clauses, the result is an empty array — the signer
 * flow then drops straight to the original view with **no error screen**. This
 * service never throws for a "bad" document; it degrades to `[]`.
 *
 * Wiring the result into the signer payload is a later grain — this service is
 * IO-free beyond the extractor call and holds no HTTP/DB knowledge.
 */
@Injectable()
export class ClauseExtractionService {
  private readonly logger = new Logger(ClauseExtractionService.name);

  constructor(
    @Inject(PDF_TEXT_EXTRACTOR)
    private readonly extractor: PdfTextExtractor,
  ) {}

  /**
   * Extract structured clause cards from raw PDF bytes.
   *
   * @returns 1–5 {@link ExtractedClause}s, or `[]` when the document has no
   *   usable text or extraction fails.
   */
  async extractFromPdf(pdf: Buffer): Promise<ExtractedClause[]> {
    let pages;
    try {
      pages = await this.extractor.extractPages(pdf);
    } catch (err) {
      // A failed extraction is not an error the signer should see — no cards.
      this.logger.warn(
        `PDF text extraction failed; returning no clause cards: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
    return selectClauses(pages);
  }
}
