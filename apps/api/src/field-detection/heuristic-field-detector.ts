import { Injectable } from '@nestjs/common';
import { matchKeyword } from './heuristic-keywords';
import { classifyScan } from './scan-detector';
import type {
  DetectedFieldType,
  FieldCandidate,
  FieldDetectionResult,
  PdfPageText,
  PdfTextLayer,
  TextToken,
} from './field-detection.types';
import { SignFieldType } from '@repo/db';

/**
 * Heuristic (keyword + pattern based) auto-field-placement engine — the default,
 * always-available tier that runs on a text-based PDF's extracted text layer
 * with **no external API calls**.
 *
 * For every positioned text run it decides whether the run is a field *label*
 * (via {@link matchKeyword}), and if so places a Text / Date / Signature
 * candidate next to it, in normalized (0..1) page coordinates ready to persist
 * as a `SignField`. It then judges the whole document:
 *
 *   - no usable text at all        → `no-text`        (image-only / scanned)
 *   - text present but weak/none    → `low-confidence`
 *   - confident candidates found    → `ok`
 *
 * Both fallback signals set `fallbackToVision`, telling the orchestration
 * (grain-4) to offer the premium Vision/LLM engine. This class is pure and
 * dependency-free so it is exhaustively fixture-tested in isolation.
 */
@Injectable()
export class HeuristicFieldDetector {
  detect(layer: PdfTextLayer): FieldDetectionResult {
    const pages = layer.pages ?? [];

    // "이미지 전용 / 스캔": delegate the scan verdict to the shared detector so
    // there is a single source of truth for text-density judgment. A fully
    // image-only document has no usable text layer for the heuristic to work on.
    if (classifyScan(layer).visionRequired) {
      return {
        engine: 'heuristic',
        signal: 'no-text',
        fields: [],
        meanConfidence: null,
        fallbackToVision: true,
      };
    }

    const raw: FieldCandidate[] = [];
    for (const page of pages) {
      if (!page.width || !page.height) continue; // undimensioned page → unplaceable
      for (const token of page.tokens ?? []) {
        const match = matchKeyword(token.text);
        if (!match || match.confidence < ACCEPT_CONFIDENCE) continue;
        const placed = this.place(page, token, match.type);
        if (placed) {
          raw.push({ ...placed, confidence: match.confidence, anchorText: token.text.trim() });
        }
      }
    }

    const fields = this.dedupe(raw);

    // Text existed but produced no usable candidates → low-confidence fallback.
    if (fields.length === 0) {
      return {
        engine: 'heuristic',
        signal: 'low-confidence',
        fields: [],
        meanConfidence: null,
        fallbackToVision: true,
      };
    }

    const meanConfidence =
      fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
    const lowConfidence = meanConfidence < RESULT_LOW_CONFIDENCE;

    return {
      engine: 'heuristic',
      signal: lowConfidence ? 'low-confidence' : 'ok',
      fields,
      meanConfidence,
      // Even with some candidates, weak overall confidence still recommends the
      // premium engine — the caller keeps these as a starting point either way.
      fallbackToVision: lowConfidence,
    };
  }

  /**
   * Place a field next to a label. Preference is to the right of the label on
   * the same line; if the right margin is too tight, it drops to the line below
   * the label. Returns normalized geometry, or `null` if the label sits so close
   * to the page edge that no usable box fits.
   */
  private place(
    page: PdfPageText,
    label: TextToken,
    type: DetectedFieldType,
  ): Omit<FieldCandidate, 'confidence' | 'anchorText'> | null {
    const h = this.heightFor(type, label.height);
    const desiredW = WIDTH_PT[type];

    // Try to the right of the label first.
    let xPt = label.x + label.width + FIELD_GAP_PT;
    let yPt = label.y; // bottom-align the box to the label's baseline box
    const rightRoom = page.width - PAGE_MARGIN_PT - xPt;

    let wPt: number;
    if (rightRoom >= MIN_FIELD_WIDTH_PT) {
      wPt = Math.min(desiredW, rightRoom);
    } else {
      // Not enough room to the right — place on the line below the label.
      xPt = label.x;
      yPt = label.y - LINE_GAP_PT - h;
      wPt = Math.min(desiredW, page.width - PAGE_MARGIN_PT - xPt);
    }

    if (wPt < MIN_FIELD_WIDTH_PT || h <= 0) return null;

    // Normalize to 0..1 and clamp inside the page box.
    const nx = clamp01(xPt / page.width);
    const ny = clamp01(yPt / page.height);
    const nw = Math.min(wPt / page.width, 1 - nx);
    const nh = Math.min(h / page.height, 1 - ny);
    if (nw <= 0 || nh <= 0) return null;

    return { type, page: page.page, x: nx, y: ny, width: nw, height: nh };
  }

  private heightFor(type: DetectedFieldType, labelHeight: number): number {
    const base = labelHeight > 0 ? labelHeight : DEFAULT_LABEL_HEIGHT_PT;
    if (type === SignFieldType.SIGNATURE) {
      return Math.max(base * 2.2, SIGNATURE_MIN_HEIGHT_PT);
    }
    return Math.max(base * 1.4, FIELD_MIN_HEIGHT_PT);
  }

  /**
   * Drop candidates that substantially overlap another, keeping the
   * higher-confidence one (greedy by confidence). Two nearby labels — or a label
   * matched by more than one cue — should not stack duplicate boxes.
   */
  private dedupe(candidates: FieldCandidate[]): FieldCandidate[] {
    const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
    const kept: FieldCandidate[] = [];
    for (const cand of sorted) {
      const clashes = kept.some(
        (k) => k.page === cand.page && iou(k, cand) > OVERLAP_IOU,
      );
      if (!clashes) kept.push(cand);
    }
    // Return in reading order (page, then top-to-bottom) for stable output.
    return kept.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  }
}

// --- heuristic-engine settings (implementation config, not design tokens) ----

/** Minimum per-candidate confidence to keep it at all. */
const ACCEPT_CONFIDENCE = 0.4;
/** Mean confidence below which the whole result is flagged low-confidence. */
const RESULT_LOW_CONFIDENCE = 0.55;
/** Fraction of overlap (IoU) above which two candidates are treated as duplicates. */
const OVERLAP_IOU = 0.5;

/** Placement geometry, in PDF points. */
const FIELD_GAP_PT = 8; // gap between a label and its field
const LINE_GAP_PT = 6; // vertical gap when dropping below the label
const PAGE_MARGIN_PT = 36; // 0.5in safety margin at the right/bottom edge
const MIN_FIELD_WIDTH_PT = 60;
const FIELD_MIN_HEIGHT_PT = 16;
const SIGNATURE_MIN_HEIGHT_PT = 32;
const DEFAULT_LABEL_HEIGHT_PT = 12;

/** Default field widths per type, in points. */
const WIDTH_PT: Record<DetectedFieldType, number> = {
  [SignFieldType.TEXT]: 180,
  [SignFieldType.DATE]: 120,
  [SignFieldType.SIGNATURE]: 150,
};

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Intersection-over-union of two normalized rects (bottom-left origin). */
function iou(a: FieldCandidate, b: FieldCandidate): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}
