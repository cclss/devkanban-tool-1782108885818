import { SignFieldType } from '@repo/db';

/**
 * Shared data contract for the auto-field-placement analysis engines.
 *
 * grain-2 (this module) produces {@link FieldDetectionResult} from a text-based
 * PDF. grain-3 (persist/return candidates) and grain-4 (heuristic→vision
 * orchestration) consume this same shape, so the field-candidate schema lives
 * here as the single source of truth. The premium Vision/LLM engine (later
 * grain) emits the identical structure so downstream code is engine-agnostic.
 *
 * The candidate field type reuses Prisma's `SignFieldType` (the persisted
 * `SignField.type`), so a candidate maps to a real field with no translation.
 */

/** The field type a candidate proposes — Prisma's `SignFieldType`. */
export type DetectedFieldType = SignFieldType;

/**
 * The engine's verdict about the analysed document.
 *
 *  - `ok`             — confident field candidates were produced.
 *  - `low-confidence` — text was present but the candidates are weak (few /
 *                       low-scoring). Candidates may still be returned, but the
 *                       caller should offer the premium engine.
 *  - `no-text`        — the PDF has no usable text layer (image-only / scanned).
 *                       No candidates; the premium (Vision) engine is the path
 *                       forward.
 *
 * `low-confidence` and `no-text` are the "저신뢰/이미지 전용" fallback signals the
 * grain requires. They are structured values, not user-facing copy — the actual
 * prompt shown to the user is composed by the UI grains.
 */
export type DetectionSignal = 'ok' | 'low-confidence' | 'no-text';

/** Which analysis engine produced a result. */
export type DetectionEngine = 'heuristic' | 'vision';

/**
 * A single positioned text run extracted from a PDF page.
 *
 * Coordinates are in PDF **points** with a **bottom-left origin** (+x right,
 * +y up) relative to the page's visible box — the same origin convention as
 * `SignField` geometry (`pdf/field-geometry.ts`). `x`/`y` are the lower-left
 * corner of the run's bounding box; `width`/`height` are its span in points.
 */
export interface TextToken {
  /** The run's text content (already whitespace-trimmed by the extractor). */
  text: string;
  /** 1-based page number the run sits on. */
  page: number;
  /** Lower-left corner X, in points from the page's left edge. */
  x: number;
  /** Lower-left corner Y, in points from the page's bottom edge. */
  y: number;
  /** Bounding-box width, in points. */
  width: number;
  /** Bounding-box height (≈ font size), in points. */
  height: number;
}

/** One page's extracted text layer plus its point dimensions. */
export interface PdfPageText {
  /** 1-based page number. */
  page: number;
  /** Page width in points. */
  width: number;
  /** Page height in points. */
  height: number;
  /** Positioned text runs on the page (order irrelevant to detection). */
  tokens: TextToken[];
}

/** A whole document's extracted text layer — the detector's only input. */
export interface PdfTextLayer {
  pages: PdfPageText[];
}

/**
 * A proposed input field. Geometry is **normalized (0..1)** relative to its page
 * with a bottom-left origin — identical to the persisted `SignFieldDto`, so a
 * candidate can be saved as a real field with no coordinate translation.
 */
export interface FieldCandidate {
  /** Proposed field type. */
  type: DetectedFieldType;
  /** 1-based page number. */
  page: number;
  /** Lower-left corner X, 0..1 of the page width. */
  x: number;
  /** Lower-left corner Y, 0..1 of the page height (from the bottom). */
  y: number;
  /** Width, 0..1 of the page width. */
  width: number;
  /** Height, 0..1 of the page height. */
  height: number;
  /** Detection confidence, 0..1. Higher = stronger keyword/structure evidence. */
  confidence: number;
  /**
   * The label text that anchored this candidate (e.g. "서명", "Date"). Kept for
   * telemetry / debugging and to let the UI explain a suggestion; it is not
   * itself user-facing copy.
   */
  anchorText: string;
}

/** The complete output of a detection engine for one document. */
export interface FieldDetectionResult {
  /** Which engine produced this result. */
  engine: DetectionEngine;
  /** Overall verdict (see {@link DetectionSignal}). */
  signal: DetectionSignal;
  /** Proposed fields (empty for `no-text`, possibly empty for `low-confidence`). */
  fields: FieldCandidate[];
  /** Mean confidence across returned fields, or `null` when there are none. */
  meanConfidence: number | null;
  /**
   * Whether the caller should offer the premium Vision/LLM engine. True for both
   * fallback signals (`no-text`, `low-confidence`); the actual access decision
   * (plan / free-trial balance) is made separately by `VisionTrialService`.
   */
  fallbackToVision: boolean;
}
