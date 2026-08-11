/**
 * Contract shapes for the signer "핵심 조항 카드" pipeline (grain-1).
 *
 * The pipeline has two clean halves so the impure PDF library never leaks into
 * the logic that decides *what* to show:
 *
 *   1. {@link PdfTextExtractor} — the isolation boundary. A single async call
 *      turns raw PDF bytes into per-page plain text. The only implementation
 *      that touches `pdfjs-dist` lives behind this interface
 *      (`pdfjs-text-extractor.ts`), so the selection heuristics stay pure and
 *      unit-testable with hand-written {@link PageText} fixtures.
 *   2. The heuristics (`clause-heuristics.ts`) + {@link ClauseExtractionService}
 *      — pure functions that segment the text into candidate clauses, score
 *      them, and return the top 1–5 as {@link ExtractedClause}s.
 *
 * Nothing here knows about HTTP, the signer payload, or the DB — wiring the
 * result into the signer screen is a later grain.
 */

/** One page of extracted text, page numbered from 1 (the deep-link anchor space). */
export interface PageText {
  /** 1-based page number — becomes an {@link ExtractedClause.page} anchor. */
  page: number;
  /** Best-effort plain text for the page. May be empty for image-only pages. */
  text: string;
}

/** The kind of key figure surfaced on a card. */
export type ClauseFigureKind = 'money' | 'period' | 'date';

/** A single highlighted figure (금액·기간·날짜) pulled from a clause body. */
export interface ClauseFigure {
  kind: ClauseFigureKind;
  /** The raw matched substring, verbatim from the source text. */
  value: string;
}

/** One structured clause card, ready to be projected onto the signer payload. */
export interface ExtractedClause {
  /** Human-readable clause title (e.g. "제3조 (계약기간)"). */
  title: string;
  /** Plain-language ("일상어") rendering of the clause body. */
  plainText: string;
  /** Key figures to emphasize on the card, in reading order, de-duplicated. */
  figures: ClauseFigure[];
  /** `true` when the clause carries risk language → render in a warning tone. */
  caution: boolean;
  /** 1-based page the clause starts on — the "원문 보기" deep-link anchor. */
  page: number;
}

/**
 * Isolation boundary over the PDF text-extraction library.
 *
 * Implementations turn raw PDF bytes into per-page text. Keeping this an
 * interface lets the heuristics be tested against fixtures and lets the concrete
 * library (`pdfjs-dist`) be swapped without touching selection logic.
 */
export interface PdfTextExtractor {
  extractPages(pdf: Buffer): Promise<PageText[]>;
}

/** Nest DI token for the {@link PdfTextExtractor} binding. */
export const PDF_TEXT_EXTRACTOR = Symbol('PDF_TEXT_EXTRACTOR');
