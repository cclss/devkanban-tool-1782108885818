import { Injectable, Logger } from '@nestjs/common';
import { ClauseExtractionStatus, Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfTextService } from './pdf-text.service';
import {
  ClauseExtractionService,
  type ExtractedClause,
} from './clause-extraction.service';
import type { ClauseExtractionResult } from './clause-extraction.constants';

/**
 * Send-time clause pre-generation orchestrator (grain-4).
 *
 * Runs once per document (idempotently) when a contract is dispatched:
 *   1. read the original PDF bytes (grain storage, S3 / local fallback),
 *   2. extract per-page text + detect non-text documents (grain-2
 *      `PdfTextService`),
 *   3. structure 0–5 clause cards (grain-3 `ClauseExtractionService` — never
 *      throws; timeout / API / non-text all collapse to an empty array),
 *   4. persist the cards as `ContractClause` rows and record the terminal
 *      `Document.clauseStatus` + `clauseExtractedAt`.
 *
 * `clauseStatus` mapping (consumed by the signer API in grain-5; EMPTY and
 * FAILED both drive the same full-PDF fallback, kept distinct for observability):
 *   • READY  — one or more cards were produced,
 *   • EMPTY  — extraction succeeded but produced zero cards (non-text document,
 *     or nothing worth surfacing),
 *   • FAILED — the pipeline itself errored (e.g. the PDF bytes were unreadable).
 *
 * Idempotency: the success path *replaces* any existing cards inside a single
 * transaction, so a re-run always converges to the same end state. A re-run on a
 * document whose bytes are gone records FAILED without destroying previously
 * cached cards.
 *
 * Boundary: this service only *composes* the grain-2/3 services — it never
 * re-implements text extraction or summarization.
 */
@Injectable()
export class ClauseExtractionPipelineService {
  private readonly logger = new Logger(ClauseExtractionPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdfText: PdfTextService,
    private readonly clauses: ClauseExtractionService,
  ) {}

  /**
   * Pre-generate and cache the clause cards for a document. Records READY /
   * EMPTY / FAILED and never rethrows extraction failures — the send response
   * and any queue retry must not be broken by a bad document.
   */
  async runExtraction(documentId: string): Promise<ClauseExtractionResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, storageKey: true },
    });

    if (!document) {
      this.logger.warn(`조항 추출 건너뜀 — 문서를 찾을 수 없어요: ${documentId}`);
      return { documentId, processed: false, skipped: true };
    }

    this.logger.log(`발송 시점 조항 추출 시작: ${documentId}`);

    let cards: ExtractedClause[];
    try {
      // 1) Original PDF bytes. A read failure (missing / unreadable object) is
      //    the pipeline's main throw surface → recorded as FAILED below.
      const pdf = await this.storage.read(document.storageKey);
      // 2) Per-page text + non-text detection (never throws).
      const extraction = await this.pdfText.extract(pdf);
      // 3) Structure clause cards (never throws; [] on timeout / failure / empty).
      cards = await this.clauses.extract(extraction.pages);
    } catch (err) {
      // Read/parse failure — record FAILED so the signer UI falls back, leaving
      // any previously cached cards untouched.
      this.logger.warn(
        `조항 추출 실패 — FAILED로 기록해요 (docId=${documentId}): ${this.describe(err)}`,
      );
      await this.recordFailure(documentId);
      return {
        documentId,
        processed: true,
        skipped: false,
        status: ClauseExtractionStatus.FAILED,
        cardCount: 0,
      };
    }

    // 4) Persist cards + terminal status. Zero cards → EMPTY, else READY.
    const status =
      cards.length > 0
        ? ClauseExtractionStatus.READY
        : ClauseExtractionStatus.EMPTY;
    await this.persist(documentId, cards, status);

    this.logger.log(
      `발송 시점 조항 추출 끝: ${documentId} (status=${status}, 카드 ${cards.length}장)`,
    );

    return {
      documentId,
      processed: true,
      skipped: false,
      status,
      cardCount: cards.length,
    };
  }

  /**
   * Replace the document's clause cards and record the resolved status in a
   * single transaction, so a re-run atomically converges (no partial state, no
   * duplicate cards).
   */
  private async persist(
    documentId: string,
    cards: ExtractedClause[],
    status: ClauseExtractionStatus,
  ): Promise<void> {
    const extractedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.contractClause.deleteMany({ where: { documentId } }),
      ...(cards.length > 0
        ? [
            this.prisma.contractClause.createMany({
              data: cards.map((c) => ({
                documentId,
                order: c.order,
                title: c.title,
                summary: c.summary,
                sourcePage: c.sourcePage,
                sourceSnippet: c.sourceSnippet ?? null,
                caution: c.caution,
                cautionReason: c.cautionReason ?? null,
              })),
            }),
          ]
        : []),
      this.prisma.document.update({
        where: { id: documentId },
        data: { clauseStatus: status, clauseExtractedAt: extractedAt },
      }),
    ]);
  }

  /**
   * Record a terminal FAILED status without touching existing cards. Best-effort
   * — a DB error here is logged, never rethrown, so the caller's response holds.
   */
  private async recordFailure(documentId: string): Promise<void> {
    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          clauseStatus: ClauseExtractionStatus.FAILED,
          clauseExtractedAt: new Date(),
        },
      });
    } catch (err) {
      // A vanished document (P2025) or transient DB error — nothing more to do.
      if (
        !(
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025'
        )
      ) {
        this.logger.error(
          `조항 상태 FAILED 기록 실패 (docId=${documentId}): ${this.describe(err)}`,
        );
      }
    }
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  }
}
