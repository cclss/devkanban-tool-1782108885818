/**
 * AI sign-field analysis orchestration.
 *
 * This wires the two halves built earlier into one `File → suggestions` flow:
 *   • the pdfjs extractor (`pdf-text.ts`, grain-2) turns a PDF into normalized
 *     text tokens, and
 *   • the pure placement engine (`signfield-suggest.ts`, grain-1) turns tokens
 *     into proposed sign fields.
 *
 * It owns nothing visual — it returns plain data the "확인" UI (grain-3/4) will
 * render. Its real value is collapsing the messy real-world outcomes into four
 * explicit states a UI can switch on without guessing:
 *
 *   • `analyzing` — in flight; surfaced via the `onProgress` callback, not the
 *     resolved value (the promise only ever resolves to a terminal state).
 *   • `done`      — at least one suggestion to show.
 *   • `empty`     — parsed fine but nothing to place, with a `reason` that tells
 *     a scanned/image PDF (`no-text-layer`) apart from a text PDF that simply had
 *     no anchor phrases (`no-anchors`). These are different user situations and
 *     deserve different copy.
 *   • `error`     — the file could not be parsed/analyzed at all.
 *
 * The orchestration logic lives in {@link analyzeDocument}, which takes an
 * already-open document and is therefore unit-testable with a fake doc.
 * {@link analyzeForSuggestions} is the thin File-facing wrapper that owns the
 * pdfjs document lifecycle (open → analyze → always destroy).
 */

import { openPdf, PdfRenderError } from './pdf';
import {
  extractTextTokens,
  type PdfDocumentLike,
} from './pdf-text';
import {
  suggestSignFields,
  type SignFieldSuggestion,
} from './signfield-suggest';

/** UI-facing lifecycle states. The resolved result is one of the terminal three. */
export type AnalysisStatus = 'analyzing' | 'done' | 'empty' | 'error';

/** Why an analysis produced no suggestions — drives which message the UI shows. */
export type AnalysisEmptyReason =
  /** No text layer at all — a scanned / image-only PDF. */
  | 'no-text-layer'
  /** Text was found, but no phrase looked like a sign-field anchor. */
  | 'no-anchors';

/** Friendly, user-facing copy per empty reason. Tone matches `pdf.ts` guards. */
export const ANALYSIS_EMPTY_MESSAGE: Record<AnalysisEmptyReason, string> = {
  'no-text-layer':
    '분석할 텍스트를 찾지 못했어요. 스캔한 이미지 PDF는 자동 배치를 제안할 수 없어요. 직접 서명란을 배치해 주세요.',
  'no-anchors':
    '서명란으로 제안할 위치를 찾지 못했어요. 직접 서명란을 배치해 주세요.',
};

/** Default message when a PDF can't be parsed at all. */
export const ANALYSIS_ERROR_MESSAGE =
  'PDF를 분석하지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.';

/** Terminal result of an analysis run. */
export type AnalysisResult =
  | {
      status: 'done';
      suggestions: SignFieldSuggestion[];
      pageCount: number;
    }
  | {
      status: 'empty';
      suggestions: [];
      pageCount: number;
      reason: AnalysisEmptyReason;
      /** Ready-to-render Korean copy for {@link reason}. */
      message: string;
    }
  | {
      status: 'error';
      suggestions: [];
      pageCount: number;
      /** Ready-to-render Korean copy for the failure. */
      message: string;
    };

export interface AnalyzeOptions {
  /**
   * Called once per page as extraction progresses, so a UI can show
   * "분석 중 (page/total)". Purely informational — analysis runs to completion
   * regardless.
   */
  onProgress?: (progress: { page: number; pageCount: number }) => void;
  /** Forwarded to the engine: cap suggestions per page (keeps the strongest). */
  maxPerPage?: number;
}

/**
 * Analyze an already-open PDF document into a terminal {@link AnalysisResult}.
 *
 * Pure orchestration over injectable surfaces ({@link PdfDocumentLike}), so it is
 * unit-testable with a fake document and never touches pdfjs or the DOM itself.
 * Does not own the document — the caller opens and disposes it.
 */
export async function analyzeDocument(
  doc: PdfDocumentLike,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const { tokens, pageCount, hadTextLayer } = await extractTextTokens(
    doc,
    options.onProgress
      ? (page, total) => options.onProgress!({ page, pageCount: total })
      : undefined,
  );

  if (!hadTextLayer) {
    return {
      status: 'empty',
      suggestions: [],
      pageCount,
      reason: 'no-text-layer',
      message: ANALYSIS_EMPTY_MESSAGE['no-text-layer'],
    };
  }

  const suggestions = suggestSignFields(tokens, {
    maxPerPage: options.maxPerPage,
  });

  if (suggestions.length === 0) {
    return {
      status: 'empty',
      suggestions: [],
      pageCount,
      reason: 'no-anchors',
      message: ANALYSIS_EMPTY_MESSAGE['no-anchors'],
    };
  }

  return { status: 'done', suggestions, pageCount };
}

/**
 * Analyze an uploaded PDF {@link File} into proposed sign fields.
 *
 * Owns the pdfjs document lifecycle: opens via the shared {@link openPdf} loader
 * (same worker config as the render path), delegates to {@link analyzeDocument},
 * and always destroys the handle — even on error — so worker resources never
 * leak across uploads.
 *
 * Never rejects: a corrupt file or mid-analysis failure resolves to an `error`
 * result so the caller switches on `status` instead of wrapping a try/catch.
 */
export async function analyzeForSuggestions(
  file: File,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  let handle: Awaited<ReturnType<typeof openPdf>>;
  try {
    handle = await openPdf(file);
  } catch (err) {
    return {
      status: 'error',
      suggestions: [],
      pageCount: 0,
      message: errorMessage(err),
    };
  }

  try {
    return await analyzeDocument(handle.doc, options);
  } catch (err) {
    return {
      status: 'error',
      suggestions: [],
      pageCount: handle.pageCount,
      message: errorMessage(err),
    };
  } finally {
    // Free worker-side resources; mirrors `renderFirstPage`'s disposal contract.
    void handle.doc.destroy();
  }
}

/** Prefer a PdfRenderError's friendly message; otherwise the generic guard. */
function errorMessage(err: unknown): string {
  if (err instanceof PdfRenderError && err.message) return err.message;
  return ANALYSIS_ERROR_MESSAGE;
}
