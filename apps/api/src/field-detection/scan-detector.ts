import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SCAN_THRESHOLDS,
  type PageScanReport,
  type ScanClass,
  type ScanDetectionResult,
  type ScanThresholds,
} from './scan-detection.types';
import type { PdfPageText, PdfTextLayer } from './field-detection.types';

/**
 * Detects whether a PDF is **scanned / image-only** by inspecting its extracted
 * text layer — the gate that decides, before any field placement, whether the
 * heuristic engine can run or the premium Vision/LLM engine is needed.
 *
 * The decision is made from **per-page text density**: a page with enough
 * word-bearing characters carries a usable text layer (`text`); a page with none
 * (or only incidental furniture) is a scanned `image`. Aggregated over the
 * document this yields a `text` / `image-only` / `mixed` verdict — see
 * {@link ScanDetectionResult}. The result is a structured signal only; the copy a
 * user eventually sees is composed by the UI grains.
 *
 * Pure and dependency-free: the detection lives in the exported {@link classifyScan}
 * function, and this class is a thin injectable wrapper so orchestration can DI it.
 */
@Injectable()
export class ScanDetector {
  /** Classify a document's extracted text layer. See {@link classifyScan}. */
  detect(
    layer: PdfTextLayer,
    thresholds?: Partial<ScanThresholds>,
  ): ScanDetectionResult {
    return classifyScan(layer, thresholds);
  }
}

/**
 * Classify a PDF's extracted text layer as `text`, `image-only`, or `mixed`.
 *
 * Returns a full {@link ScanDetectionResult} including a per-page density report.
 * A document with no pages (an empty layer, as the extractor returns for an
 * unreadable/scanned PDF) is reported as `image-only`.
 */
export function classifyScan(
  layer: PdfTextLayer,
  thresholds: Partial<ScanThresholds> = {},
): ScanDetectionResult {
  const cfg: ScanThresholds = { ...DEFAULT_SCAN_THRESHOLDS, ...thresholds };
  const pages = layer?.pages ?? [];

  const reports = pages.map((page) => reportPage(page, cfg));

  const pageCount = reports.length;
  const textPageCount = reports.filter((r) => r.classification === 'text').length;
  const scannedPageCount = pageCount - textPageCount;
  // No pages at all reads as fully image-only (nothing usable to place fields on).
  const scannedPageRatio = pageCount === 0 ? 1 : scannedPageCount / pageCount;

  const scanClass: ScanClass =
    textPageCount === 0
      ? 'image-only'
      : scannedPageCount === 0
        ? 'text'
        : 'mixed';

  return {
    scanClass,
    // Vision is *required* only when nothing is placeable by the heuristic engine.
    visionRequired: scanClass === 'image-only',
    // Vision is *recommended* whenever any page is a scan.
    visionRecommended: scanClass !== 'text',
    pageCount,
    textPageCount,
    scannedPageCount,
    scannedPageRatio,
    pages: reports,
  };
}

/** Measure one page's text density and classify it. */
function reportPage(page: PdfPageText, cfg: ScanThresholds): PageScanReport {
  const tokens = page.tokens ?? [];
  const area = page.width > 0 && page.height > 0 ? page.width * page.height : 0;

  let wordChars = 0;
  let wordTokens = 0;
  let coveredArea = 0;

  for (const token of tokens) {
    const chars = countWordChars(token.text);
    if (chars > 0) {
      wordChars += chars;
      wordTokens += 1;
      if (area > 0) {
        coveredArea += Math.max(0, token.width) * Math.max(0, token.height);
      }
    }
  }

  const textCoverage = area > 0 ? clamp01(coveredArea / area) : 0;

  return {
    page: page.page,
    classification: wordChars >= cfg.pageMinTextChars ? 'text' : 'image',
    wordChars,
    wordTokens,
    textCoverage,
    whitespaceRatio: clamp01(1 - textCoverage),
  };
}

/** Count Unicode letters/digits in a run — the "word-bearing" character measure. */
function countWordChars(text: string): number {
  const matches = (text ?? '').match(WORD_CHAR_GLOBAL);
  return matches ? matches.length : 0;
}

/** Matches every Unicode letter or digit (global) — text vs scan discriminator. */
const WORD_CHAR_GLOBAL = /[\p{L}\p{N}]/gu;

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
