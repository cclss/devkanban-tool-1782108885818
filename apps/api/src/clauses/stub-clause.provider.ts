import { Injectable, Logger } from '@nestjs/common';
import { MESSAGES } from '../common/messages';
import type {
  CautionCategory,
  ClauseExtractionProvider,
  RawExtractedClause,
} from './clause-extraction.provider';
import type { PdfPageText } from './pdf-text.service';

/**
 * One detectable clause type for the heuristic. `keywords` are matched
 * case-insensitively against page text (Korean + English, since contracts mix
 * both); `title`/`summary` come from `MESSAGES.clause.stub` (single-source copy,
 * never authored here); `caution` is the taxonomy category the service maps to
 * the fixed reason label. Order here is the card-ordering tiebreak.
 */
interface StubClauseSpec {
  keywords: readonly string[];
  copy: { title: string; summary: string };
  caution: CautionCategory;
}

/**
 * Fixed, ordered heuristic table. Deterministic by construction: same text
 * always yields the same cards in the same order. Cautionable types come first
 * so they win the 3–5 card cap when a document matches many types.
 */
const STUB_CLAUSE_SPECS: readonly StubClauseSpec[] = [
  {
    keywords: ['자동 갱신', '자동갱신', '자동으로 갱신', 'auto-renew', 'automatically renew', 'renewal'],
    copy: MESSAGES.clause.stub.autoRenewal,
    caution: 'AUTO_RENEWAL',
  },
  {
    keywords: ['위약금', '중도 해지', '중도해지', '해지', 'termination', 'early termination', 'penalty'],
    copy: MESSAGES.clause.stub.earlyTermination,
    caution: 'EARLY_TERMINATION_PENALTY',
  },
  {
    keywords: ['대금', '금액', '지급', '납부', '요금', '비용', 'payment', 'fee', 'invoice', 'price'],
    copy: MESSAGES.clause.stub.payment,
    caution: 'PAYMENT_OBLIGATION',
  },
  {
    keywords: ['손해배상', '배상', '책임', '면책', 'liability', 'indemn', 'damages'],
    copy: MESSAGES.clause.stub.liability,
    caution: 'LIABILITY',
  },
  {
    keywords: ['개인정보', '제3자 제공', '제삼자', 'personal data', 'personal information', 'privacy'],
    copy: MESSAGES.clause.stub.personalData,
    caution: 'PERSONAL_DATA',
  },
  {
    keywords: ['계약 기간', '계약기간', '유효기간', '존속기간', 'term of', 'contract period', 'duration'],
    copy: MESSAGES.clause.stub.term,
    caution: 'NONE',
  },
  {
    keywords: ['준거법', '관할', '분쟁', '중재', 'governing law', 'jurisdiction', 'dispute', 'arbitration'],
    copy: MESSAGES.clause.stub.governingLaw,
    caution: 'NONE',
  },
];

/** Cap so the stub never floods the stack beyond the 3–5 card target. */
const STUB_MAX_CLAUSES = 5;

/**
 * Deterministic heuristic fallback used when no LLM credentials are configured
 * — same philosophy as the S3 → local-disk / SES → console-log stubs: the full
 * flow works locally without cloud credentials.
 *
 * It keyword-scans page-tagged text for well-known clause types and emits a card
 * per matched type, anchored to the first page the keyword appears on. The
 * summary/title are fixed single-source copy, so results are reproducible and
 * carry no improvised wording.
 */
@Injectable()
export class StubClauseProvider implements ClauseExtractionProvider {
  readonly name = 'stub';
  private readonly logger = new Logger(StubClauseProvider.name);

  // eslint-disable-next-line @typescript-eslint/require-await
  async extract(
    pages: PdfPageText[],
    _signal: AbortSignal,
  ): Promise<RawExtractedClause[]> {
    const clauses: RawExtractedClause[] = [];

    for (const spec of STUB_CLAUSE_SPECS) {
      if (clauses.length >= STUB_MAX_CLAUSES) break;
      const page = this.firstMatchingPage(pages, spec.keywords);
      if (page === undefined) continue;
      clauses.push({
        title: spec.copy.title,
        summary: spec.copy.summary,
        sourcePage: page.page,
        sourceSnippet: this.snippet(page, spec.keywords),
        cautionCategory: spec.caution,
      });
    }

    this.logger.debug(
      `heuristic stub produced ${clauses.length} clause card(s) from ${pages.length} page(s)`,
    );
    return clauses;
  }

  /** First page whose text contains any keyword (case-insensitive). */
  private firstMatchingPage(
    pages: PdfPageText[],
    keywords: readonly string[],
  ): PdfPageText | undefined {
    return pages.find((page) => {
      const haystack = page.text.toLowerCase();
      return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
    });
  }

  /**
   * The first line on `page` that contains a keyword, trimmed to a reasonable
   * snippet length. Deterministic — always the first matching line.
   */
  private snippet(
    page: PdfPageText,
    keywords: readonly string[],
  ): string | undefined {
    const line = page.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => {
        const lower = l.toLowerCase();
        return keywords.some((kw) => lower.includes(kw.toLowerCase()));
      });
    if (!line) return undefined;
    return line.length > 200 ? `${line.slice(0, 200)}…` : line;
  }
}
