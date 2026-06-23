import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { CompletionService } from './completion.service';
import { CompletionQueue } from './completion.queue';

/**
 * Completion post-processing module (grain-5).
 *
 * Wires the BullMQ producer/worker (`CompletionQueue`) to the orchestrator
 * (`CompletionService`), which composes the grain-2/3/4 services:
 *   • PdfModule  → SignedPdfService + AuditCertificateService
 *   • EmailModule (global) → EmailService
 *   • StorageModule / PrismaModule (global) → Storage + Prisma
 *
 * Exports `CompletionQueue` so the signing flow can enqueue a job when the last
 * signer completes.
 */
@Module({
  imports: [PdfModule],
  providers: [CompletionService, CompletionQueue],
  exports: [CompletionQueue],
})
export class CompletionModule {}
