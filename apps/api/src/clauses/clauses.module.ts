import { Module } from '@nestjs/common';
import { PdfTextService } from './pdf-text.service';

/**
 * Clauses module — home of the AI clause-card pipeline (extract → summarize →
 * cache → serve). This grain seeds it with the first, purely mechanical step:
 *
 *   • `PdfTextService` — extracts per-page text from PDF bytes and detects
 *     non-text (scanned/image) documents, absorbing parse failures as empty
 *     results.
 *
 * Intentionally separate from `PdfModule` (signed-PDF / audit-certificate
 * rendering, Korean-font embedding): that module *writes* PDFs, this one *reads*
 * their text. Later grains (AI summarization, clause persistence, signer API)
 * import this module to reuse the service.
 */
@Module({
  providers: [PdfTextService],
  exports: [PdfTextService],
})
export class ClausesModule {}
