import { Module } from '@nestjs/common';
import { SignedPdfService } from './signed-pdf.service';
import { AuditCertificateService } from './audit-certificate.service';

/**
 * PDF synthesis module. Owns the pure, IO-free PDF services:
 *   • `SignedPdfService` — composites captured sign-field values onto the
 *     original document (grain-2).
 *   • `AuditCertificateService` — renders the audit-trail certificate PDF from
 *     queried domain data + document hashes (grain-3).
 *
 * The completion pipeline (grain-5) imports this module to reuse both services
 * and the shared Korean-font util.
 */
@Module({
  providers: [SignedPdfService, AuditCertificateService],
  exports: [SignedPdfService, AuditCertificateService],
})
export class PdfModule {}
