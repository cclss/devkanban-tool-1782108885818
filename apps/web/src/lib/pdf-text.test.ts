/**
 * PDF text-extractor unit tests.
 *
 * These pin the coordinate normalization (pdfjs transform/viewport → bottom-left,
 * 0..1 {@link TextToken} bbox) and the document walk, using synthetic text-item
 * fixtures so pdfjs is never booted:
 *   • baseline placement on an unrotated page,
 *   • marked-content + blank-run filtering,
 *   • a scanned (text-free) document → empty tokens + `hadTextLayer: false`,
 *   • sequential multi-page extraction with progress + cleanup.
 */

import {
  textItemToToken,
  extractTextTokens,
  type TextItemLike,
  type ViewportLike,
  type PdfDocumentLike,
  type PdfPageLike,
} from './pdf-text';

/** Unrotated scale-1 viewport for a `w × h` page: `[1,0,0,-1,0,h]`, y-flipped. */
function viewport(w: number, h: number): ViewportLike {
  return { width: w, height: h, transform: [1, 0, 0, -1, 0, h] };
}

/**
 * A text item whose baseline-left origin sits at PDF user-space `(e, f)` (y up),
 * with the given device-space run `width`/`height`.
 */
function item(
  str: string,
  e: number,
  f: number,
  width: number,
  height: number,
): TextItemLike {
  return { str, transform: [height, 0, 0, height, e, f], width, height };
}

describe('textItemToToken — normalization', () => {
  it('maps a baseline origin to a bottom-left, 0..1 bbox', () => {
    // 100×200 page; run at PDF (70, 180) — near the top-right — size 24×12.
    const t = textItemToToken(item('서명', 70, 180, 24, 12), viewport(100, 200), 1);
    expect(t).not.toBeNull();
    expect(t!.text).toBe('서명');
    expect(t!.page).toBe(1);
    expect(t!.rect.x).toBeCloseTo(0.7, 6);
    // f=180 of 200 high (y up) → lower-left y at 180/200 = 0.9.
    expect(t!.rect.y).toBeCloseTo(0.9, 6);
    expect(t!.rect.width).toBeCloseTo(0.24, 6);
    expect(t!.rect.height).toBeCloseTo(0.06, 6);
  });

  it('keeps the box fully in-page (y + height <= 1)', () => {
    const t = textItemToToken(item('date', 70, 180, 24, 12), viewport(100, 200), 1);
    expect(t).not.toBeNull();
    expect(t!.rect.x + t!.rect.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(t!.rect.y + t!.rect.height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('places a bottom-of-page run near y = 0', () => {
    // Baseline at f=10 of a 200-high page → bottom edge.
    const t = textItemToToken(item('signature', 10, 10, 40, 10), viewport(100, 200), 2);
    expect(t).not.toBeNull();
    expect(t!.rect.y).toBeCloseTo(0.05, 6);
    expect(t!.page).toBe(2);
  });

  it('falls back to the matrix height when item height is 0', () => {
    const raw: TextItemLike = {
      str: 'x',
      transform: [10, 0, 0, 10, 50, 100],
      width: 8,
      height: 0,
    };
    const t = textItemToToken(raw, viewport(100, 200), 1);
    expect(t).not.toBeNull();
    // hypot of the matrix vertical scale (10) over a 200-high page.
    expect(t!.rect.height).toBeCloseTo(10 / 200, 6);
  });

  it('returns null for blank / whitespace-only runs', () => {
    expect(textItemToToken(item('', 10, 10, 5, 10), viewport(100, 200), 1)).toBeNull();
    expect(textItemToToken(item('   ', 10, 10, 5, 10), viewport(100, 200), 1)).toBeNull();
  });

  it('returns null for a degenerate viewport or non-finite geometry', () => {
    expect(textItemToToken(item('a', 10, 10, 5, 10), viewport(0, 0), 1)).toBeNull();
    const bad: TextItemLike = {
      str: 'a',
      transform: [1, 0, 0, 1, Number.NaN, 10],
      width: 5,
      height: 10,
    };
    expect(textItemToToken(bad, viewport(100, 200), 1)).toBeNull();
  });
});

// --- Document walk ---------------------------------------------------------

/** Build a fake page; records cleanup() calls into `cleaned`. */
function fakePage(
  items: ReadonlyArray<unknown>,
  size: { w: number; h: number },
  cleaned: number[],
  pageNo: number,
): PdfPageLike {
  return {
    getViewport: () => viewport(size.w, size.h),
    getTextContent: async () => ({ items }),
    cleanup: () => cleaned.push(pageNo),
  };
}

/** Build a fake multi-page document from per-page item arrays. */
function fakeDoc(
  pages: ReadonlyArray<ReadonlyArray<unknown>>,
  cleaned: number[] = [],
  size = { w: 100, h: 200 },
): PdfDocumentLike {
  return {
    numPages: pages.length,
    getPage: async (n: number) => fakePage(pages[n - 1] ?? [], size, cleaned, n),
  };
}

describe('extractTextTokens — document walk', () => {
  it('collects tokens across pages and reports a text layer', async () => {
    const doc = fakeDoc([
      [item('서명', 70, 180, 24, 12)],
      [item('날짜', 20, 150, 18, 12), item('이름', 20, 120, 18, 12)],
    ]);
    const res = await extractTextTokens(doc);
    expect(res.pageCount).toBe(2);
    expect(res.hadTextLayer).toBe(true);
    expect(res.tokens.map((t) => t.text)).toEqual(['서명', '날짜', '이름']);
    expect(res.tokens.map((t) => t.page)).toEqual([1, 2, 2]);
  });

  it('filters TextMarkedContent and blank runs but still sees a text layer', async () => {
    const doc = fakeDoc([
      [
        { type: 'beginMarkedContent', id: 'mc-1' }, // marked content → dropped
        item('   ', 10, 180, 5, 12), // blank run → dropped, but proves a layer
        item('서명', 70, 180, 24, 12),
      ],
    ]);
    const res = await extractTextTokens(doc);
    expect(res.hadTextLayer).toBe(true);
    expect(res.tokens.map((t) => t.text)).toEqual(['서명']);
  });

  it('reports no text layer for a scanned (image-only) PDF', async () => {
    const doc = fakeDoc([[], []]); // pdfjs yields no items for an image scan
    const res = await extractTextTokens(doc);
    expect(res.pageCount).toBe(2);
    expect(res.hadTextLayer).toBe(false);
    expect(res.tokens).toEqual([]);
  });

  it('emits per-page progress and cleans every page', async () => {
    const cleaned: number[] = [];
    const doc = fakeDoc([[item('a', 10, 10, 5, 10)], [], [item('b', 10, 10, 5, 10)]], cleaned);
    const progress: Array<[number, number]> = [];
    await extractTextTokens(doc, (page, total) => progress.push([page, total]));
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(cleaned).toEqual([1, 2, 3]);
  });

  it('handles a zero-page document without throwing', async () => {
    const res = await extractTextTokens(fakeDoc([]));
    expect(res).toEqual({ tokens: [], pageCount: 0, hadTextLayer: false });
  });
});
