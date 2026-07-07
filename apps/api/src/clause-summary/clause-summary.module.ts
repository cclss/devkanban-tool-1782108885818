import { Module } from '@nestjs/common';
import { ClauseSummaryService } from './clause-summary.service';
import { ClauseSummaryLlm } from './clause-summary.llm';
import { PdfTextService } from './pdf-text.service';
import { ClauseSummaryQueue } from './clause-summary.queue';

/**
 * Clause-summary generation module (feature: AI 핵심 조항 카드).
 *
 * Provides the core `ClauseSummaryService.generate(documentId)`:
 *   • StorageService  → original PDF bytes (global StorageModule)
 *   • PrismaService   → idempotent `clauseSummary` persistence (global PrismaModule)
 *   • PdfTextService  → PDF → text extraction
 *   • ClauseSummaryLlm → text → structured summary (graceful no-op when unconfigured)
 *
 * Also wires the background producer/worker (`ClauseSummaryQueue`) that runs
 * generation off the request path (BullMQ when REDIS_URL is set, inline
 * otherwise), mirroring the completion pipeline's queue convention.
 *
 * Exports `ClauseSummaryQueue` so the send flow can fire-and-forget a summary
 * job, and `ClauseSummaryService` for callers that need the core pipeline.
 */
@Module({
  providers: [ClauseSummaryService, ClauseSummaryLlm, PdfTextService, ClauseSummaryQueue],
  exports: [ClauseSummaryService, ClauseSummaryQueue],
})
export class ClauseSummaryModule {}
