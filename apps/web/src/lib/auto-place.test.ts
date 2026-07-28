/**
 * Auto-placement orchestration unit tests.
 *
 * These pin the grain's contract: `autoPlaceFields` chains
 * openPdf→extractPagePhrases→suggestFields, always destroys an opened document,
 * and degrades to `[]` (never throws) for corrupt / non-text / erroring PDFs so
 * the manual placement flow stays available.
 *
 * `./pdf` is mocked so no pdfjs runtime or real File is needed: `openPdf`
 * returns a hand-rolled document stub whose `getPage`/`view`/`getTextContent`/
 * `cleanup` mirror the members `extractPagePhrases` reads — the real extraction
 * and placement code then runs unmodified over synthetic PDF-point geometry.
 */

import { PdfRenderError } from './pdf';

// Mock the pdfjs-backed loader; every test supplies openPdf's behavior. The
// module is otherwise pure (PdfRenderError is a plain Error subclass).
jest.mock('./pdf', () => ({
  ...jest.requireActual('./pdf'),
  openPdf: jest.fn(),
}));

import { autoPlaceFields } from './auto-place';
import { openPdf } from './pdf';
import type { TextItemLike } from './pdf-text';

const mockOpenPdf = openPdf as jest.MockedFunction<typeof openPdf>;

const A4_W = 595;
const A4_H = 842;

/** Build a PDF-point text item: upright matrix, baseline origin at (x, baseline). */
function item(str: string, x: number, baseline: number, width: number, height = 12): TextItemLike {
  return { str, transform: [height, 0, 0, height, x, baseline], width, height };
}

/**
 * A minimal pdfjs-document stub over `pagesItems` (one entry per page). Exposes
 * only the members the pipeline touches, plus a spied `destroy` so the cleanup
 * guarantee is observable.
 */
function stubDoc(pagesItems: TextItemLike[][]) {
  const destroy = jest.fn(() => Promise.resolve());
  const doc = {
    numPages: pagesItems.length,
    getPage: async (n: number) => ({
      view: [0, 0, A4_W, A4_H] as [number, number, number, number],
      getTextContent: async () => ({ items: pagesItems[n - 1] ?? [] }),
      cleanup: () => {},
    }),
    destroy,
  };
  return { doc, destroy };
}

/** openPdf's resolved shape, cast to the loader's return type for the mock. */
function resolveWith(doc: ReturnType<typeof stubDoc>['doc']) {
  return { doc, pageCount: doc.numPages } as unknown as Awaited<ReturnType<typeof openPdf>>;
}

const anyFile = {} as File;

afterEach(() => jest.clearAllMocks());

describe('autoPlaceFields', () => {
  it('returns candidates for a text PDF carrying anchor phrases', async () => {
    const { doc, destroy } = stubDoc([
      [item('서명', 100, 700, 24)],
      [item('금액', 100, 600, 24), item('1,000,000', 140, 600, 60), item('원', 210, 600, 12)],
    ]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    const candidates = await autoPlaceFields(anyFile);

    expect(candidates.length).toBeGreaterThan(0);
    const sign = candidates.find((c) => c.category === 'SIGN');
    expect(sign?.type).toBe('SIGNATURE');
    expect(sign?.page).toBe(1);
    expect(candidates.some((c) => c.category === 'AMOUNT')).toBe(true);
    // Every candidate stays a valid in-page NormRect.
    for (const c of candidates) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.width).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Opened document is always freed.
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns [] and destroys the doc when no anchor phrases are present', async () => {
    const { doc, destroy } = stubDoc([[item('hello world', 100, 700, 60)]]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns [] for a scanned / text-layer-less PDF (pages yield no items)', async () => {
    const { doc, destroy } = stubDoc([[], []]);
    mockOpenPdf.mockResolvedValue(resolveWith(doc));

    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns [] without throwing when the file is not a parseable PDF', async () => {
    mockOpenPdf.mockRejectedValue(new PdfRenderError());

    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
  });

  it('returns [] and still destroys the doc when extraction throws mid-walk', async () => {
    const destroy = jest.fn(() => Promise.resolve());
    // A document whose page count access throws once extraction begins — the
    // orchestrator must swallow it and still run cleanup.
    const doc = {
      get numPages(): number {
        throw new Error('boom');
      },
      getPage: async () => ({
        view: [0, 0, A4_W, A4_H],
        getTextContent: async () => ({ items: [] }),
        cleanup: () => {},
      }),
      destroy,
    };
    mockOpenPdf.mockResolvedValue({ doc, pageCount: 0 } as unknown as Awaited<
      ReturnType<typeof openPdf>
    >);

    await expect(autoPlaceFields(anyFile)).resolves.toEqual([]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
