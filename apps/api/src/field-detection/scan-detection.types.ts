/**
 * Data contract for **scanned / image-only PDF detection** — the first stage of
 * the auto-field-placement pipeline.
 *
 * Before any engine tries to place fields, the pipeline inspects the extracted
 * text layer to decide whether the document actually carries usable text. An
 * image-only (scanned) PDF has no extractable text layer, so the heuristic engine
 * has nothing to work with and the premium Vision/LLM engine is the only path
 * forward. This module produces that verdict as a structured, **engine-agnostic**
 * signal — no user-facing copy, just the facts downstream orchestration
 * (grain-2/grain-3) and the UI grains consume.
 *
 * The verdict is derived from **per-page text density**: how much word-bearing
 * text a page's layer contains and how much of the page area it covers. This
 * makes the boundary cases explicit — a document can be fully text, fully
 * image-only, or a `mixed` combination of both (a "partial scan").
 */

/**
 * How a whole document reads once every page has been classified.
 *
 *  - `text`       — every page carries a usable text layer. The heuristic engine
 *                   can run; Vision is not required.
 *  - `image-only` — no page carries a usable text layer (classic scanned PDF).
 *                   The heuristic engine finds nothing; Vision is required.
 *  - `mixed`      — some pages have text and some are image-only (a partial
 *                   scan). The heuristic engine can still work on the text pages,
 *                   so Vision is *recommended* for the scanned remainder rather
 *                   than strictly required.
 */
export type ScanClass = 'text' | 'image-only' | 'mixed';

/** How a single page reads. */
export type PageScanClass = 'text' | 'image';

/**
 * Per-page density measurements plus the resulting classification. Exposed so
 * orchestration and telemetry can see *why* a document was judged the way it was
 * (and which specific pages need Vision), not just the final verdict.
 */
export interface PageScanReport {
  /** 1-based page number. */
  page: number;
  /** `text` when the page has a usable text layer, else `image` (scanned). */
  classification: PageScanClass;
  /** Total letter/digit characters across the page's text runs. */
  wordChars: number;
  /** Number of text runs that contain at least one letter/digit. */
  wordTokens: number;
  /**
   * Fraction of the page area (0..1) covered by word-bearing text boxes — the
   * text-density metric. Bounding boxes are summed without subtracting overlap,
   * so this is an upper-bound approximation, clamped to 1. `0` when the page has
   * no dimensions.
   */
  textCoverage: number;
  /** `1 - textCoverage`: the whitespace share of the page (0..1). */
  whitespaceRatio: number;
}

/** The complete scanned-document verdict for one PDF. */
export interface ScanDetectionResult {
  /** Document-level reading (see {@link ScanClass}). */
  scanClass: ScanClass;
  /**
   * `true` only when the document is fully `image-only` — no page has a usable
   * text layer, so the heuristic engine cannot run and Vision is required. This
   * is the "Vision 필요" signal the grain requires; a `text` document reports
   * `false` ("불필요").
   */
  visionRequired: boolean;
  /**
   * `true` when *any* page is image-only (`image-only` or `mixed`). Distinct from
   * {@link visionRequired}: a mixed document can still get heuristic candidates on
   * its text pages, so Vision is offered rather than forced. The actual access
   * decision (plan / free-trial balance) is made separately downstream.
   */
  visionRecommended: boolean;
  /** Number of pages in the document. */
  pageCount: number;
  /** Pages classified `text`. */
  textPageCount: number;
  /** Pages classified `image` (scanned). */
  scannedPageCount: number;
  /**
   * `scannedPageCount / pageCount` (0..1). A document with no pages reports `1`
   * (nothing to read = fully image-only).
   */
  scannedPageRatio: number;
  /** Per-page density reports, in page order. */
  pages: PageScanReport[];
}

/**
 * Tunable thresholds for scan detection. These are **implementation config**,
 * not design tokens — changing them alters routing logic, not anything a user
 * sees. Callers may override per document; defaults live in {@link DEFAULT_SCAN_THRESHOLDS}.
 */
export interface ScanThresholds {
  /**
   * Minimum letter/digit characters a page's text layer must contain to count as
   * a `text` page. Below this, the page is `image` — the text layer holds only
   * incidental furniture (a lone page number, stray punctuation) or nothing at
   * all, which is how a scanned page presents. Kept low so even a sparse form
   * (e.g. a single "서명:" label) still reads as text.
   */
  pageMinTextChars: number;
  /**
   * Coverage (0..1) below which a `text` page is additionally flagged as
   * low-density for telemetry. Informational only — it does **not** flip a page
   * to `image` (character count is the authoritative gate), so a legitimately
   * sparse form is never mistaken for a scan.
   */
  lowDensityCoverage: number;
}

/** Default {@link ScanThresholds}. */
export const DEFAULT_SCAN_THRESHOLDS: ScanThresholds = {
  pageMinTextChars: 2,
  lowDensityCoverage: 0.008,
};
