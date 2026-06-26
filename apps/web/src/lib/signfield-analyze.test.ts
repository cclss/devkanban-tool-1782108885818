/**
 * Sign-field analysis orchestration tests.
 *
 * `analyzeDocument` is exercised with fake documents (no pdfjs), covering the
 * three terminal states and their reasons:
 *   • anchors found            → `done` with suggestions,
 *   • text but no anchors      → `empty` / `no-anchors`,
 *   • scanned / image-only PDF → `empty` / `no-text-layer`.
 *
 * `analyzeForSuggestions` is exercised with `./pdf` mocked, pinning the File-
 * facing lifecycle: the document is always destroyed, and open/analyze failures
 * resolve to an `error` result instead of rejecting.
 */

import {
  analyzeDocument,
  analyzeForSuggestions,
  ANALYSIS_EMPTY_MESSAGE,
  ANALYSIS_ERROR_MESSAGE,
} from './signfield-analyze';
import { type TextItemLike, type PdfDocumentLike } from './pdf-text';
import { openPdf, PdfRenderError, type PdfDocument } from './pdf';

jest.mock('./pdf', () => {
  const actual = jest.requireActual('./pdf');
  return { ...actual, openPdf: jest.fn() };
});

const mockOpenPdf = openPdf as jest.MockedFunction<typeof openPdf>;

/** Text item whose baseline-left origin sits at PDF user-space `(e, f)`. */
function item(str: string, e: number, f: number): TextItemLike {
  return { str, transform: [12, 0, 0, 12, e, f], width: 24, height: 12 };
}

/** A fake document over per-page item arrays, on a 100×200 page. */
function fakeDoc(pages: ReadonlyArray<ReadonlyArray<unknown>>): PdfDocumentLike {
  return {
    numPages: pages.length,
    getPage: async (n: number) => ({
      getViewport: () => ({ width: 100, height: 200, transform: [1, 0, 0, -1, 0, 200] }),
      getTextContent: async () => ({ items: pages[n - 1] ?? [] }),
    }),
  };
}

describe('analyzeDocument', () => {
  it('returns done with suggestions when anchors are found', async () => {
    const res = await analyzeDocument(fakeDoc([[item('서명', 60, 160)]]));
    expect(res.status).toBe('done');
    expect(res.pageCount).toBe(1);
    expect(res.suggestions.length).toBeGreaterThan(0);
    const first = res.suggestions[0]!;
    expect(first.type).toBe('SIGNATURE');
    expect(first.source).toBe('ai');
  });

  it('returns empty / no-anchors when text has no anchor phrases', async () => {
    const res = await analyzeDocument(fakeDoc([[item('안녕하세요', 60, 160)]]));
    expect(res.status).toBe('empty');
    expect(res.suggestions).toEqual([]);
    if (res.status === 'empty') {
      expect(res.reason).toBe('no-anchors');
      expect(res.message).toBe(ANALYSIS_EMPTY_MESSAGE['no-anchors']);
    }
  });

  it('returns empty / no-text-layer for a scanned PDF', async () => {
    const res = await analyzeDocument(fakeDoc([[], []]));
    expect(res.status).toBe('empty');
    expect(res.pageCount).toBe(2);
    if (res.status === 'empty') {
      expect(res.reason).toBe('no-text-layer');
      expect(res.message).toBe(ANALYSIS_EMPTY_MESSAGE['no-text-layer']);
    }
  });

  it('forwards onProgress per page', async () => {
    const seen: Array<{ page: number; pageCount: number }> = [];
    await analyzeDocument(fakeDoc([[item('서명', 60, 160)], []]), {
      onProgress: (p) => seen.push(p),
    });
    expect(seen).toEqual([
      { page: 1, pageCount: 2 },
      { page: 2, pageCount: 2 },
    ]);
  });

  it('honors maxPerPage', async () => {
    const res = await analyzeDocument(
      fakeDoc([[item('서명', 60, 180), item('날짜', 60, 150), item('이름', 60, 120)]]),
      { maxPerPage: 1 },
    );
    expect(res.status).toBe('done');
    expect(res.suggestions).toHaveLength(1);
  });
});

describe('analyzeForSuggestions — File lifecycle', () => {
  beforeEach(() => mockOpenPdf.mockReset());

  it('destroys the document after a successful analysis', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const doc = { ...fakeDoc([[item('서명', 60, 160)]]), destroy } as unknown as PdfDocument;
    mockOpenPdf.mockResolvedValue({ doc, pageCount: 1 });

    const res = await analyzeForSuggestions({} as File);
    expect(res.status).toBe('done');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('resolves to error (not reject) when the file cannot be opened', async () => {
    mockOpenPdf.mockRejectedValue(new PdfRenderError());
    const res = await analyzeForSuggestions({} as File);
    expect(res.status).toBe('error');
    expect(res.pageCount).toBe(0);
    if (res.status === 'error') {
      // Surfaces the PdfRenderError's friendly Korean copy.
      expect(res.message).toBe(new PdfRenderError().message);
    }
  });

  it('resolves to error and still destroys when analysis throws mid-run', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const doc = {
      numPages: 1,
      getPage: async () => {
        throw new Error('boom');
      },
      destroy,
    } as unknown as PdfDocument;
    mockOpenPdf.mockResolvedValue({ doc, pageCount: 1 });

    const res = await analyzeForSuggestions({} as File);
    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.message).toBe(ANALYSIS_ERROR_MESSAGE);
    }
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
