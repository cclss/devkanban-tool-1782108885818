import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CLAUSE_EXTRACTION_PROVIDER,
  cautionLabelFor,
  type ClauseExtractionProvider,
  type RawExtractedClause,
} from './clause-extraction.provider';
import type { PdfPageText } from './pdf-text.service';

/**
 * A normalized clause card, ready for persistence (grain-4) / the signer API
 * (grain-5). Field shape mirrors the `ContractClause` model minus persistence
 * columns (`id`/`documentId`/`createdAt`).
 */
export interface ExtractedClause {
  /** 1-based display order within the card stack. */
  order: number;
  title: string;
  summary: string;
  /** 1-based source page the clause is grounded in. */
  sourcePage: number;
  sourceSnippet?: string;
  caution: boolean;
  /** Fixed single-source reason copy; present only when `caution` is true. */
  cautionReason?: string;
}

/** Hard cap on cards returned, regardless of what a provider yields (M6). */
export const MAX_CLAUSE_CARDS = 5;
/** Default LLM call timeout (ms). Overridable via `CLAUSE_EXTRACTION_TIMEOUT_MS`. */
export const DEFAULT_CLAUSE_TIMEOUT_MS = 20_000;

/**
 * Orchestrates clause-card extraction behind a provider abstraction, and is the
 * single choke point that guarantees the pipeline's failure contract:
 *
 *   empty/non-text input, LLM timeout, API failure, and JSON parse failure all
 *   resolve to an **empty array — never a thrown error**.
 *
 * The main pipeline (grain-4) records an empty result as EMPTY/FAILED so the
 * signer frontend falls back to the full-document viewer. This service never
 * throws to its caller.
 */
@Injectable()
export class ClauseExtractionService {
  private readonly logger = new Logger(ClauseExtractionService.name);

  constructor(
    @Inject(CLAUSE_EXTRACTION_PROVIDER)
    private readonly provider: ClauseExtractionProvider,
    private readonly timeoutMs: number = DEFAULT_CLAUSE_TIMEOUT_MS,
  ) {}

  /**
   * Extract 0–{@link MAX_CLAUSE_CARDS} clause cards from page-tagged contract
   * text. Returns `[]` (never throws) on empty input, timeout, or any provider
   * failure.
   */
  async extract(pages: PdfPageText[]): Promise<ExtractedClause[]> {
    if (!this.hasUsableText(pages)) {
      // Empty / non-text document — nothing to summarize.
      return [];
    }

    let raw: RawExtractedClause[];
    try {
      raw = await this.withTimeout((signal) =>
        this.provider.extract(pages, signal),
      );
    } catch (err) {
      // Timeout, API failure, JSON parse failure — all degrade to empty.
      this.logger.warn(
        `clause extraction via '${this.provider.name}' failed; returning empty: ${this.describe(
          err,
        )}`,
      );
      return [];
    }

    return this.normalize(raw);
  }

  /** True when at least one page carries non-whitespace text. */
  private hasUsableText(pages: PdfPageText[]): boolean {
    return pages.some((page) => page.text.trim().length > 0);
  }

  /**
   * Cap, order, and map raw clauses to cards. Caution wording is resolved from
   * the fixed single-source labels here — never from provider output.
   */
  private normalize(raw: RawExtractedClause[]): ExtractedClause[] {
    return raw.slice(0, MAX_CLAUSE_CARDS).map((clause, index) => {
      const cautionReason = cautionLabelFor(clause.cautionCategory);
      return {
        order: index + 1,
        title: clause.title,
        summary: clause.summary,
        sourcePage: Math.max(1, Math.trunc(clause.sourcePage)),
        sourceSnippet: clause.sourceSnippet,
        caution: cautionReason !== undefined,
        cautionReason,
      };
    });
  }

  /**
   * Run `task` under a hard timeout. On expiry the shared `AbortSignal` is
   * aborted (so the LLM request is cancelled) and the returned promise rejects.
   */
  private withTimeout<T>(
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`clause extraction timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    return Promise.race([task(controller.signal), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private describe(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
  }
}
