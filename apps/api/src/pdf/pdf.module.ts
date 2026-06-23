import { Module } from '@nestjs/common';
import { SignedPdfService } from './signed-pdf.service';

/**
 * PDF synthesis module. Owns the pure, IO-free PDF services:
 *   • `SignedPdfService` — composites captured sign-field values onto the
 *     original document (grain-2).
 *
 * The audit-certificate service (grain-3) and the completion pipeline (grain-5)
 * import this module to reuse `SignedPdfService` and the shared Korean-font util.
 */
@Module({
  providers: [SignedPdfService],
  exports: [SignedPdfService],
})
export class PdfModule {}
