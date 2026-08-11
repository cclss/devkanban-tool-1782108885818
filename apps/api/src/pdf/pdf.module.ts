import { Module } from '@nestjs/common';
import { SignedPdfService } from './signed-pdf.service';
import { AuditCertificateService } from './audit-certificate.service';
import { ClauseExtractionService } from './clause-extraction.service';
import { PdfjsTextExtractor } from './pdfjs-text-extractor';
import { PDF_TEXT_EXTRACTOR } from './clause-extraction.types';

/**
 * PDF synthesis module. Owns the pure, IO-free PDF services:
 *   • `SignedPdfService` — composites captured sign-field values onto the
 *     original document (grain-2).
 *   • `AuditCertificateService` — renders the audit-trail certificate PDF from
 *     queried domain data + document hashes (grain-3).
 *   • `ClauseExtractionService` — extracts the top 1–5 "핵심 조항" cards from a
 *     contract PDF for the signer screen (grain-1). The `pdfjs-dist` dependency
 *     is isolated behind the `PDF_TEXT_EXTRACTOR` token so the selection
 *     heuristics stay pure and testable.
 *
 * The completion pipeline (grain-5) imports this module to reuse both services
 * and the shared Korean-font util.
 */
@Module({
  providers: [
    SignedPdfService,
    AuditCertificateService,
    ClauseExtractionService,
    { provide: PDF_TEXT_EXTRACTOR, useClass: PdfjsTextExtractor },
  ],
  exports: [SignedPdfService, AuditCertificateService, ClauseExtractionService],
})
export class PdfModule {}
