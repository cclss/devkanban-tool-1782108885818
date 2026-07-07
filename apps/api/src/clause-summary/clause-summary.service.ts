import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfTextService } from './pdf-text.service';
import { ClauseSummaryLlm } from './clause-summary.llm';
import { buildDocumentBody, hasExtractableText } from './clause-summary.constants';

/**
 * Clause-summary generation core service (feature: AI 핵심 조항 카드).
 *
 * `generate(documentId)` reads the original PDF, extracts its text, asks the
 * LLM for a 3–5 clause summary matching the shared `ClauseSummary` contract,
 * and stores it idempotently on `Document.clauseSummary`.
 *
 * Design intent — this NEVER throws and NEVER blocks document sending:
 *   - No API key / config → no-op (the summary stays `null`).
 *   - PDF unreadable / no extractable text (scanned image PDF — OCR is out of
 *     scope) / LLM failure or refusal → logged, no-op.
 * A `null` summary is the defined graceful fallback: the signer/share screen
 * simply shows the plain original-document viewer.
 *
 * Idempotency: the write is guarded on `clauseSummary: null` (the same
 * null-guard pattern `completion.service` uses on `completedAt`), so a re-run
 * or a concurrent duplicate never overwrites an existing summary. A cheap
 * up-front check also skips the PDF/LLM work when a summary already exists.
 *
 * Boundary: this grain owns only the core service. The background job/worker
 * that calls it and the send-flow trigger are separate grains; wiring
 * `clauseSummary` into the signer/share API response is already done upstream.
 */
@Injectable()
export class ClauseSummaryService {
  private readonly logger = new Logger(ClauseSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdfText: PdfTextService,
    private readonly llm: ClauseSummaryLlm,
  ) {}

  /**
   * Generate and store the clause summary for a document. Safe to call
   * repeatedly; a no-op when unconfigured, already summarized, or on failure.
   */
  async generate(documentId: string): Promise<void> {
    // Graceful degradation: nothing to do without a configured LLM.
    if (!this.llm.isConfigured) {
      this.logger.log(
        `클로즈 요약 건너뜀 — 요약 생성이 설정되지 않았어요(ANTHROPIC_API_KEY 미설정): ${documentId}`,
      );
      return;
    }

    try {
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, storageKey: true, clauseSummary: true },
      });

      if (!document) {
        this.logger.warn(`클로즈 요약 건너뜀 — 문서를 찾을 수 없어요: ${documentId}`);
        return;
      }

      // Fast idempotency short-circuit: avoid PDF/LLM work if already summarized.
      if (document.clauseSummary != null) {
        this.logger.log(`클로즈 요약 건너뜀 — 이미 요약이 있어요: ${documentId}`);
        return;
      }

      // 1) Original PDF → per-page text.
      const pdf = await this.storage.read(document.storageKey);
      const { pages } = await this.pdfText.extract(pdf);

      if (!hasExtractableText(pages)) {
        // Scanned/image-only PDF (OCR out of scope) — leave summary null.
        this.logger.log(
          `클로즈 요약 건너뜀 — 추출 가능한 텍스트가 없어요(스캔 이미지 PDF일 수 있어요): ${documentId}`,
        );
        return;
      }

      // 2) Text → structured clause summary.
      const { body, truncated } = buildDocumentBody(pages);
      const summary = await this.llm.summarize(body, truncated);

      if (!summary) {
        this.logger.warn(`클로즈 요약 생성 결과가 비어 있어 저장하지 않아요: ${documentId}`);
        return;
      }

      // 3) Idempotent write: only fills a still-null column.
      const result = await this.prisma.document.updateMany({
        where: { id: documentId, clauseSummary: { equals: Prisma.DbNull } },
        data: { clauseSummary: summary as unknown as Prisma.InputJsonValue },
      });

      if (result.count === 0) {
        this.logger.log(`클로즈 요약 저장 건너뜀 — 다른 처리가 이미 채웠어요: ${documentId}`);
        return;
      }

      this.logger.log(
        `클로즈 요약 저장 완료: ${documentId} (조항 ${summary.clauses.length}개)`,
      );
    } catch (err) {
      // Never throw: summary generation failing must not block document sending.
      this.logger.warn(`클로즈 요약 생성 실패 — 요약 없이 진행해요: ${documentId} (${String(err)})`);
    }
  }
}
