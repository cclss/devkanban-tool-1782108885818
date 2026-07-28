/**
 * Phrase-extraction unit tests.
 *
 * These pin the spec's Measures (design-spec §4, M1–M9): every phrase carries a
 * field-compatible NormRect (0..1, in-bounds, bottom-left/y-up), same-line runs
 * merge while columns/lines split, blank/scanned pages degrade to `[]` without
 * throwing, and the result always spans every page.
 *
 * The merge math is exercised as a pure function over synthetic PDF-point items;
 * `extractPagePhrases` is driven by a hand-rolled document stub so no real PDF or
 * pdfjs runtime is needed.
 */

import {
  phrasesForPage,
  extractPagePhrases,
  type TextItemLike,
  type Phrase,
} from './pdf-text';
import type { NormRect } from './field-geometry';

const A4_W = 595;
const A4_H = 842;

/** Build a PDF-point text item: upright matrix, baseline origin at (x, baseline). */
function item(
  str: string,
  x: number,
  baseline: number,
  width: number,
  height = 12,
  hasEOL = false,
): TextItemLike {
  return { str, transform: [height, 0, 0, height, x, baseline], width, height, hasEOL };
}

/** Assert a rect satisfies the stored-field contract (M2, M5): 0..1 and in-bounds. */
function expectInBounds(rect: NormRect) {
  const eps = 1e-9;
  for (const v of [rect.x, rect.y, rect.width, rect.height]) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
  expect(rect.x + rect.width).toBeLessThanOrEqual(1 + eps);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1 + eps);
}

describe('phrasesForPage — merging', () => {
  it('merges same-baseline runs within a small gap into one phrase', () => {
    // "성명" then ":" then a value, all on one line, split as pdfjs would.
    const items = [
      item('성명', 100, 700, 24),
      item(':', 128, 700, 6),
      item('홍길동', 140, 700, 36),
    ];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.text).toBe('성명 : 홍길동');
    expect(phrases[0]!.page).toBe(1);
  });

  it('splits runs on different baselines into separate phrases (M1: one per line)', () => {
    const items = [item('첫째 줄', 100, 700, 60), item('둘째 줄', 100, 680, 60)];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H);
    expect(phrases).toHaveLength(2);
    expect(phrases.map((p) => p.text)).toEqual(['첫째 줄', '둘째 줄']);
  });

  it('splits same-line runs separated by a large horizontal gap (columns)', () => {
    const items = [item('왼쪽', 60, 700, 40), item('오른쪽', 400, 700, 60)];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H);
    expect(phrases).toHaveLength(2);
    expect(phrases.map((p) => p.text)).toEqual(['왼쪽', '오른쪽']);
  });

  it('breaks a phrase when the previous item flags end-of-line', () => {
    const items = [
      item('라벨', 100, 700, 40, 12, true),
      item('값', 145, 700, 20),
    ];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H);
    expect(phrases).toHaveLength(2);
  });
});

describe('phrasesForPage — text hygiene (M6)', () => {
  it('drops phrases whose text is empty/whitespace only', () => {
    const items = [item('   ', 100, 700, 20), item('\t', 130, 700, 6)];
    expect(phrasesForPage(items, 1, A4_W, A4_H)).toHaveLength(0);
  });

  it('every emitted phrase has non-empty trimmed text', () => {
    const items = [item('  안녕  ', 100, 700, 40), item('세상', 150, 700, 30)];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H);
    for (const p of phrases) expect(p.text.trim().length).toBeGreaterThanOrEqual(1);
  });
});

describe('phrasesForPage — NormRect contract (M2, M3, M5)', () => {
  const items = [
    item('상단', 20, 820, 40), // near top edge
    item('하단', 20, 20, 40), // near bottom edge
    item('넘침', 560, 400, 200), // runs past the right edge → must clamp
  ];
  const phrases = phrasesForPage(items, 3, A4_W, A4_H);

  it('keeps all rects within 0..1 and inside the page', () => {
    for (const p of phrases) expectInBounds(p.rect);
  });

  it('uses bottom-left origin with +y up (higher baseline → larger y)', () => {
    const top = phrases.find((p) => p.text === '상단')!;
    const bottom = phrases.find((p) => p.text === '하단')!;
    expect(top.rect.y).toBeGreaterThan(bottom.rect.y);
    // y is the baseline (minus descender) normalized directly — no canvas y-flip.
    expect(bottom.rect.y).toBeCloseTo((20 - 0.2 * 12) / A4_H, 5);
  });

  it('exposes exactly the SignFieldDto rect keys', () => {
    expect(Object.keys(phrases[0]!.rect).sort()).toEqual(['height', 'width', 'x', 'y']);
  });
});

describe('phrasesForPage — mediabox origin offset', () => {
  it('normalizes against a non-zero mediabox origin', () => {
    // Mediabox [100, 200, 100+595, 200+842]: a run at its lower-left → rect ~ (0,0).
    const items = [item('구석', 100, 200, 30)];
    const phrases = phrasesForPage(items, 1, A4_W, A4_H, 100, 200);
    expect(phrases[0]!.rect.x).toBeCloseTo(0, 5);
    expect(phrases[0]!.rect.y).toBeCloseTo(0, 5); // clamped from a tiny negative descender
  });
});

// --- extractPagePhrases: page coverage + scanned-page safety (M7, M9) -------

interface StubPage {
  view: [number, number, number, number];
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup: () => void;
}

function stubDoc(pageItems: TextItemLike[][]): PdfDocumentStub {
  return {
    numPages: pageItems.length,
    getPage: async (n: number): Promise<StubPage> => ({
      view: [0, 0, A4_W, A4_H],
      getTextContent: async () => ({ items: pageItems[n - 1] ?? [] }),
      cleanup: () => {},
    }),
  };
}

interface PdfDocumentStub {
  numPages: number;
  getPage: (n: number) => Promise<StubPage>;
}

// The real PdfDocument is a pdfjs handle; extractPagePhrases only touches
// numPages / getPage / view / getTextContent / cleanup, all present on the stub.
const asDoc = (d: PdfDocumentStub) => d as unknown as Parameters<typeof extractPagePhrases>[0];

describe('extractPagePhrases', () => {
  it('returns one entry per page in order (M9: length = pageCount)', async () => {
    const doc = stubDoc([
      [item('페이지1', 100, 700, 60)],
      [item('페이지2', 100, 700, 60)],
      [item('페이지3', 100, 700, 60)],
    ]);
    const result = await extractPagePhrases(asDoc(doc));
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.page)).toEqual([1, 2, 3]);
    for (const page of result) {
      expect(page.phrases.length).toBeGreaterThanOrEqual(1); // M1
      for (const p of page.phrases) expectInBounds(p.rect); // M2/M5
    }
  });

  it('returns phrases: [] for a text-layer-less (scanned) page without throwing (M7)', async () => {
    const doc = stubDoc([[item('텍스트', 100, 700, 60)], []]);
    const result = await extractPagePhrases(asDoc(doc));
    expect(result).toHaveLength(2);
    expect(result[1]!.phrases).toEqual([]);
  });

  it('absorbs a per-page read failure as an empty page', async () => {
    const doc: PdfDocumentStub = {
      numPages: 2,
      getPage: async (n: number): Promise<StubPage> => {
        if (n === 2) throw new Error('boom');
        return {
          view: [0, 0, A4_W, A4_H],
          getTextContent: async () => ({ items: [item('ok', 100, 700, 40)] }),
          cleanup: () => {},
        };
      },
    };
    const result = await extractPagePhrases(asDoc(doc));
    expect(result).toHaveLength(2);
    expect(result[0]!.phrases.length).toBeGreaterThanOrEqual(1);
    expect(result[1]!.phrases).toEqual([]);
  });

  it('produces field-ready rects assignable straight to a SignFieldDto shape (M3)', async () => {
    const doc = stubDoc([[item('서명', 100, 700, 40)]]);
    const result = await extractPagePhrases(asDoc(doc));
    const p: Phrase = result[0]!.phrases[0]!;
    // No conversion: a phrase.rect drops straight into the stored field payload.
    const field = { type: 'SIGNATURE', page: p.page, ...p.rect };
    expect(field.page).toBeGreaterThanOrEqual(1);
    expectInBounds({ x: field.x, y: field.y, width: field.width, height: field.height });
  });
});
