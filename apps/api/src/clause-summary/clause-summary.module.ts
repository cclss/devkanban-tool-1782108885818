import { Module } from '@nestjs/common';
import { ClauseSummaryService } from './clause-summary.service';
import { ClauseSummaryLlm } from './clause-summary.llm';
import { PdfTextService } from './pdf-text.service';

/**
 * Clause-summary generation module (feature: AI 핵심 조항 카드).
 *
 * Provides the core `ClauseSummaryService.generate(documentId)`:
 *   • StorageService  → original PDF bytes (global StorageModule)
 *   • PrismaService   → idempotent `clauseSummary` persistence (global PrismaModule)
 *   • PdfTextService  → PDF → text extraction
 *   • ClauseSummaryLlm → text → structured summary (graceful no-op when unconfigured)
 *
 * Exports `ClauseSummaryService` so the background job/worker grain can enqueue
 * generation without re-implementing the pipeline.
 */
@Module({
  providers: [ClauseSummaryService, ClauseSummaryLlm, PdfTextService],
  exports: [ClauseSummaryService],
})
export class ClauseSummaryModule {}
