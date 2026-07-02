import { MESSAGES } from '../common/messages';
import type { PdfPageText } from './pdf-text.service';

/**
 * Caution-flag taxonomy. A provider classifies each clause into exactly one of
 * these categories; `ClauseExtractionService` maps the category to the fixed,
 * single-source label copy in `MESSAGES.clause.caution` — the provider never
 * authors the user-facing caution wording itself.
 *
 * Taxonomy + label decisions are recorded in the design spec
 * (`conventions/messaging.md`, decision M7).
 */
export type CautionCategory =
  | 'NONE'
  | 'AUTO_RENEWAL'
  | 'EARLY_TERMINATION_PENALTY'
  | 'PAYMENT_OBLIGATION'
  | 'LIABILITY'
  | 'PERSONAL_DATA'
  | 'OTHER';

/** Every category a provider may return, for schema/enum construction. */
export const CAUTION_CATEGORIES: readonly CautionCategory[] = [
  'NONE',
  'AUTO_RENEWAL',
  'EARLY_TERMINATION_PENALTY',
  'PAYMENT_OBLIGATION',
  'LIABILITY',
  'PERSONAL_DATA',
  'OTHER',
] as const;

/**
 * Maps a caution category to its fixed, single-source reason label. `NONE`
 * yields `undefined` (no flag). The label is signer-facing copy governed by the
 * project's messaging voice — it lives only in `MESSAGES`.
 */
export function cautionLabelFor(
  category: CautionCategory,
): string | undefined {
  switch (category) {
    case 'AUTO_RENEWAL':
      return MESSAGES.clause.caution.autoRenewal;
    case 'EARLY_TERMINATION_PENALTY':
      return MESSAGES.clause.caution.earlyTerminationPenalty;
    case 'PAYMENT_OBLIGATION':
      return MESSAGES.clause.caution.paymentObligation;
    case 'LIABILITY':
      return MESSAGES.clause.caution.liability;
    case 'PERSONAL_DATA':
      return MESSAGES.clause.caution.personalData;
    case 'OTHER':
      return MESSAGES.clause.caution.other;
    case 'NONE':
    default:
      return undefined;
  }
}

/**
 * A single clause as returned by a provider, before the service normalizes it.
 * `title` and `summary` are content (dynamic for the LLM adapter, fixed
 * single-source copy for the stub); `cautionCategory` is a taxonomy label the
 * service maps to the fixed reason copy. The provider does not decide ordering
 * or the final caution wording.
 */
export interface RawExtractedClause {
  title: string;
  summary: string;
  /** 1-based source page the clause is grounded in. */
  sourcePage: number;
  /** Verbatim source excerpt backing the summary, when available. */
  sourceSnippet?: string;
  cautionCategory: CautionCategory;
}

/**
 * The abstraction both back-ends implement:
 *   • `AnthropicClauseProvider` — LLM adapter, active when credentials are set.
 *   • `StubClauseProvider` — deterministic heuristic fallback, otherwise.
 *
 * A provider MAY throw (API failure, JSON parse failure, timeout via the passed
 * `AbortSignal`). `ClauseExtractionService` is the single place that absorbs
 * every failure into an empty result — providers do not need to.
 */
export interface ClauseExtractionProvider {
  /** Short identifier for logs (e.g. `anthropic`, `stub`). */
  readonly name: string;
  /**
   * Extract candidate clause cards from page-tagged contract text. `pages` is
   * guaranteed non-empty and to contain some text (the service short-circuits
   * empty input before calling the provider).
   */
  extract(
    pages: PdfPageText[],
    signal: AbortSignal,
  ): Promise<RawExtractedClause[]>;
}

/** DI token for the selected clause-extraction provider. */
export const CLAUSE_EXTRACTION_PROVIDER = Symbol('CLAUSE_EXTRACTION_PROVIDER');
