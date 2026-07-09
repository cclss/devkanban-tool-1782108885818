/**
 * Unit tests for the text-heuristic field-suggestion engine (grain-3).
 *
 * Scope (grain-4): the engine's PUBLIC pure surface only — the coordinate
 * transform pair, the anchor matcher, the box placer, and the `suggestSignFields`
 * entry point. No new production logic is exercised here; these tests pin the
 * behavior grain-3 already ships.
 *
 * The headline risk this suite defends against is the plan's "가장 흔한 버그":
 * a coordinate-convention mismatch. So the coordinate mapping is round-tripped
 * with an EXPLICIT tolerance (`ROUND_TRIP_TOLERANCE`), and every emitted field is
 * checked against the `SignFieldDto` contract (normalized 0..1, bottom-left
 * origin, in-page, `recipientIndex = 0`).
 *
 * Fixtures are real PDFs built with pdf-lib and run through the actual grain-2
 * extractor, so the "PDF → text layer → suggestions" pipeline is tested
 * end-to-end for both the text-layer and the no-text-layer (scanned) case.
 */

// The engine imports `documents.dto`, whose class-validator decorators need the
// metadata reflection polyfill at load time (Nest provides it via bootstrap; a
// bare unit spec must pull it in itself).
import 'reflect-metadata';
import { PDFDocument, rgb } from 'pdf-lib';
import {
  FIELD_TYPE_META,
  MIN_NORM_HEIGHT,
  MIN_NORM_WIDTH,
  type NormRect,
  type PageSize,
} from '@repo/field-geometry';

import { SignFieldDto, SignFieldTypeDto } from '../dto/documents.dto';
import { embedKoreanFont } from '../../pdf/korean-font';
import { extractPdfTextLayer, type PageRect } from './pdf-text-extraction';
import {
  DRAFT_PLACEMENT,
  matchAnchorType,
  normRectToPage,
  pageRectToNorm,
  placeFieldBox,
  suggestSignFields,
} from './field-suggestion-engine';

/** Floating-point slack for exact-equality comparisons after clamping. */
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One Korean anchor label drawn on a contract fixture (pdf-lib coords). */
interface DrawnAnchor {
  text: string;
  x: number; // bottom-left origin, points
  y: number;
}

/**
 * Build a realistic single-signer Korean contract PDF: a real text layer whose
 * fragments include SIGNATURE / DATE / TEXT anchor keywords. A4-ish page size so
 * absolute coordinates are easy to reason about. Korean is rendered with the
 * bundled Nanum Gothic TTF (pdf-lib's standard fonts are Latin-only).
 */
async function makeContractPdf(
  pagesAnchors: DrawnAnchor[][],
  size: [number, number] = [595, 842],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await embedKoreanFont(doc);
  for (const anchors of pagesAnchors) {
    const page = doc.addPage(size);
    for (const a of anchors) {
      page.drawText(a.text, { x: a.x, y: a.y, size: 13, font, color: rgb(0, 0, 0) });
    }
  }
  return Buffer.from(await doc.save());
}

/** Build a scanned-style / image-only PDF: shapes but no text layer at all. */
async function makeImageOnlyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 40, y: 40, width: 200, height: 120, color: rgb(0.2, 0.4, 0.6) });
  page.drawCircle({ x: 300, y: 500, size: 80, color: rgb(0.8, 0.2, 0.2) });
  return Buffer.from(await doc.save());
}

/**
 * Assert one suggested field satisfies the full `SignFieldDto` output contract
 * (기획서 §5): valid type/page, normalized 0..1, in-page (bottom-left origin),
 * respects the minimum grabbable size, single signer.
 */
function expectValidSignField(field: SignFieldDto, pageCount: number): void {
  // type is a real enum member; page is a 1-based index within the document.
  expect(Object.values(SignFieldTypeDto)).toContain(field.type);
  expect(Number.isInteger(field.page)).toBe(true);
  expect(field.page).toBeGreaterThanOrEqual(1);
  expect(field.page).toBeLessThanOrEqual(pageCount);

  // Every coordinate is a normalized 0..1 ratio.
  for (const v of [field.x, field.y, field.width, field.height]) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }

  // Bottom-left origin + span stays fully inside the page (clampNormRect).
  expect(field.x + field.width).toBeLessThanOrEqual(1 + EPS);
  expect(field.y + field.height).toBeLessThanOrEqual(1 + EPS);

  // Never smaller than the minimum grabbable footprint.
  expect(field.width).toBeGreaterThanOrEqual(MIN_NORM_WIDTH - EPS);
  expect(field.height).toBeGreaterThanOrEqual(MIN_NORM_HEIGHT - EPS);

  // Single-signer constraint: every suggested field targets recipient 0.
  expect(field.recipientIndex).toBe(0);
}

// ---------------------------------------------------------------------------
// 1. Coordinate round-trip — the anti-"convention mismatch" defense
// ---------------------------------------------------------------------------

describe('pageRectToNorm ↔ normRectToPage (coordinate round-trip)', () => {
  /**
   * Explicit tolerance for the round-trip (grain-4 boundary: "좌표 오차 허용치를
   * 명시"). The mapping is a pure per-axis scale, so the only error is IEEE-754
   * rounding — well under 1e-9 for these magnitudes.
   */
  const ROUND_TRIP_TOLERANCE = 1e-9;

  // A spread of page geometries (square, portrait, A4) …
  const PAGES: PageSize[] = [
    { width: 300, height: 400 },
    { width: 595, height: 842 },
    { width: 1000, height: 1000 },
  ];

  // … and rects that fit inside the smallest page, so every (rect, page) pair
  // normalizes into a valid 0..1 box. Includes the origin corner and a near-edge
  // sliver to probe the extremes.
  const RECTS: PageRect[] = [
    { x: 0, y: 0, width: 100, height: 20 },
    { x: 80, y: 120, width: 150, height: 24 },
    { x: 200, y: 360, width: 90, height: 30 },
    { x: 299.5, y: 399.5, width: 0.5, height: 0.5 },
  ];

  it('recovers the original page rect within tolerance (page → norm → page)', () => {
    for (const page of PAGES) {
      for (const rect of RECTS) {
        const norm = pageRectToNorm(rect, page);
        const back = normRectToPage(norm, page);

        expect(Math.abs(back.x - rect.x)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        expect(Math.abs(back.y - rect.y)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        expect(Math.abs(back.width - rect.width)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
        expect(Math.abs(back.height - rect.height)).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
      }
    }
  });

  it('produces valid 0..1 normalized ratios for an in-page rect', () => {
    for (const page of PAGES) {
      for (const rect of RECTS) {
        const norm = pageRectToNorm(rect, page);
        for (const v of Object.values(norm)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('normalizes with the known scale factors (forward direction)', () => {
    const page: PageSize = { width: 300, height: 420 };
    const norm = pageRectToNorm({ x: 150, y: 210, width: 60, height: 42 }, page);
    expect(norm.x).toBeCloseTo(0.5, 12);
    expect(norm.y).toBeCloseTo(0.5, 12);
    expect(norm.width).toBeCloseTo(0.2, 12);
    expect(norm.height).toBeCloseTo(0.1, 12);
  });

  it('does not flip the y axis: a lower page rect stays lower once normalized', () => {
    const page: PageSize = { width: 595, height: 842 };
    const low = pageRectToNorm({ x: 50, y: 30, width: 100, height: 20 }, page);
    const high = pageRectToNorm({ x: 50, y: 780, width: 100, height: 20 }, page);

    // +y up in both spaces → the visually-lower run keeps the smaller y.
    expect(low.y).toBeLessThan(high.y);
    // And round-tripping preserves that ordering (no hidden flip on the way back).
    expect(normRectToPage(low, page).y).toBeLessThan(normRectToPage(high, page).y);
  });
});

// ---------------------------------------------------------------------------
// 2. Anchor matching (pure) — priority + tolerant matching
// ---------------------------------------------------------------------------

describe('matchAnchorType', () => {
  it('matches each type from its keyword set', () => {
    expect(matchAnchorType('서명란')).toBe('SIGNATURE');
    expect(matchAnchorType('날짜')).toBe('DATE');
    expect(matchAnchorType('이름')).toBe('TEXT');
    expect(matchAnchorType('주소')).toBe('TEXT');
  });

  it('is case-insensitive for Latin keywords', () => {
    expect(matchAnchorType('SIGNATURE')).toBe('SIGNATURE');
    expect(matchAnchorType('Date')).toBe('DATE');
  });

  it('collapses whitespace before matching (년   월   일 ≡ 년 월 일)', () => {
    expect(matchAnchorType('년   월   일')).toBe('DATE');
  });

  it('resolves a keyword shared by two sets to the geometry-order winner', () => {
    // 성명 anchors both SIGNATURE and TEXT; SIGNATURE comes first in FIELD_TYPES.
    expect(matchAnchorType('성명')).toBe('SIGNATURE');
  });

  it('returns null for a fragment with no anchor keyword (and for blank text)', () => {
    expect(matchAnchorType('제1조 계약의 목적')).toBeNull();
    expect(matchAnchorType('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Box placement (pure) — right by default, below on overflow, always valid
// ---------------------------------------------------------------------------

describe('placeFieldBox', () => {
  it('places the field to the right of the anchor, vertically centered', () => {
    const anchor: NormRect = { x: 0.2, y: 0.5, width: 0.05, height: 0.03 };
    const box = placeFieldBox('SIGNATURE', anchor);
    const size = FIELD_TYPE_META.SIGNATURE.defaultSize;

    expect(box.x).toBeCloseTo(anchor.x + anchor.width + DRAFT_PLACEMENT.gapX, 9);
    expect(box.y).toBeCloseTo(anchor.y + anchor.height / 2 - size.height / 2, 9);
    expect(box.width).toBeCloseTo(size.width, 9);
    expect(box.height).toBeCloseTo(size.height, 9);
  });

  it('falls below the anchor when the right margin cannot fit the box', () => {
    // Anchor hugs the right edge: right-placement would overflow past x = 1.
    const anchor: NormRect = { x: 0.8, y: 0.5, width: 0.05, height: 0.03 };
    const box = placeFieldBox('SIGNATURE', anchor);

    expect(box.y).toBeLessThan(anchor.y); // dropped below the anchor
    // Still a valid in-page box after clamping.
    expect(box.x + box.width).toBeLessThanOrEqual(1 + EPS);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it('always returns a clamped, in-page, min-sized box (even for a corner anchor)', () => {
    const anchor: NormRect = { x: 0.99, y: 0.01, width: 0.02, height: 0.02 };
    for (const type of ['SIGNATURE', 'DATE', 'TEXT'] as const) {
      const box = placeFieldBox(type, anchor);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1 + EPS);
      expect(box.y + box.height).toBeLessThanOrEqual(1 + EPS);
      expect(box.width).toBeGreaterThanOrEqual(MIN_NORM_WIDTH - EPS);
      expect(box.height).toBeGreaterThanOrEqual(MIN_NORM_HEIGHT - EPS);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. suggestSignFields — end-to-end over real PDFs
// ---------------------------------------------------------------------------

describe('suggestSignFields (PDF → text layer → suggestions)', () => {
  it('returns a valid SignFieldDto[] for a sample contract with a text layer', async () => {
    // Two-page single-signer contract; anchors spread across both pages so the
    // 1-based page assignment is exercised too.
    const pdf = await makeContractPdf([
      [
        { text: '서명:', x: 90, y: 640 }, // SIGNATURE
        { text: '날짜:', x: 90, y: 560 }, // DATE
      ],
      [
        { text: '이름:', x: 90, y: 700 }, // TEXT
        { text: '주소:', x: 90, y: 620 }, // TEXT
      ],
    ]);

    const layer = await extractPdfTextLayer(pdf);
    expect(layer.hasTextLayer).toBe(true);

    const fields = suggestSignFields(layer);

    // Non-empty: the anchors produced draft fields.
    expect(fields.length).toBeGreaterThan(0);

    // Every field satisfies the output contract.
    for (const field of fields) expectValidSignField(field, layer.pages.length);

    // All three field types were suggested from the contract's anchors.
    const types = new Set(fields.map((f) => f.type));
    expect(types).toContain(SignFieldTypeDto.SIGNATURE);
    expect(types).toContain(SignFieldTypeDto.DATE);
    expect(types).toContain(SignFieldTypeDto.TEXT);

    // Fields landed on both pages (page assignment is real, not all page 1).
    const usedPages = new Set(fields.map((f) => f.page));
    expect(usedPages).toContain(1);
    expect(usedPages).toContain(2);
  });

  it('returns an empty array for a scanned / image-only PDF (no text layer)', async () => {
    const pdf = await makeImageOnlyPdf();

    const layer = await extractPdfTextLayer(pdf);
    expect(layer.hasTextLayer).toBe(false);

    // Manual-placement fallback: nothing to suggest.
    expect(suggestSignFields(layer)).toEqual([]);
  });

  it('returns an empty array when a text layer exists but no anchors match', async () => {
    const pdf = await makeContractPdf([
      [{ text: '제1조 계약의 목적', x: 90, y: 700 }],
    ]);

    const layer = await extractPdfTextLayer(pdf);
    expect(layer.hasTextLayer).toBe(true);
    expect(suggestSignFields(layer)).toEqual([]);
  });
});
