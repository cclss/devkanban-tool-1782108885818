import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfTextService } from './pdf-text.service';
import {
  CLAUSE_EXTRACTION_PROVIDER,
  type ClauseExtractionProvider,
} from './clause-extraction.provider';
import { AnthropicClauseProvider } from './anthropic-clause.provider';
import { StubClauseProvider } from './stub-clause.provider';
import {
  ClauseExtractionService,
  DEFAULT_CLAUSE_TIMEOUT_MS,
} from './clause-extraction.service';

/**
 * Selects the clause-extraction back-end from the environment — the same
 * credential-gated pattern as StorageService (S3 vs local) and EmailService
 * (SES vs console): the LLM adapter activates only when `ANTHROPIC_API_KEY` is
 * set, otherwise the deterministic heuristic stub keeps the flow working with no
 * credentials.
 */
function createClauseProvider(config: ConfigService): ClauseExtractionProvider {
  const logger = new Logger('ClausesModule');
  const apiKey = config.get<string>('ANTHROPIC_API_KEY');
  if (apiKey) {
    logger.log('ANTHROPIC_API_KEY 감지 — LLM 조항 추출 어댑터를 사용합니다.');
    return new AnthropicClauseProvider({
      apiKey,
      model: config.get<string>('ANTHROPIC_MODEL') || undefined,
    });
  }
  logger.log(
    'ANTHROPIC_API_KEY 미설정 — 휴리스틱 스텁 조항 추출로 대체합니다.',
  );
  return new StubClauseProvider();
}

/**
 * Clauses module — home of the AI clause-card pipeline (extract → summarize →
 * cache → serve). This grain adds the summarization step:
 *
 *   • `ClauseExtractionService` — turns page-tagged contract text into 3–5
 *     structured clause cards, behind a provider abstraction. Timeout, API
 *     failure, JSON parse failure, and empty/non-text input all resolve to an
 *     empty array (never throw), so the pipeline can record EMPTY/FAILED and the
 *     signer UI falls back to the full-document viewer.
 *   • `PdfTextService` (grain-2) — feeds the per-page text this consumes.
 *
 * Later grains (persistence, send-time pre-generation hook, signer API) import
 * this module to reuse the service.
 */
@Module({
  providers: [
    PdfTextService,
    {
      provide: CLAUSE_EXTRACTION_PROVIDER,
      useFactory: createClauseProvider,
      inject: [ConfigService],
    },
    {
      provide: ClauseExtractionService,
      useFactory: (
        provider: ClauseExtractionProvider,
        config: ConfigService,
      ) =>
        new ClauseExtractionService(
          provider,
          Number(config.get<string>('CLAUSE_EXTRACTION_TIMEOUT_MS')) ||
            DEFAULT_CLAUSE_TIMEOUT_MS,
        ),
      inject: [CLAUSE_EXTRACTION_PROVIDER, ConfigService],
    },
  ],
  exports: [PdfTextService, ClauseExtractionService],
})
export class ClausesModule {}
