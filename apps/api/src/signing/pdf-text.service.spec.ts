import { PdfTextService } from './pdf-text.service';

/** One text item as pdfjs actually yields it (a bare glyph run, an explicit
 *  space, or an end-of-line marker). */
type FakeItem = { str: string; hasEOL?: boolean };

/**
 * A fake pdfjs module standing in for the real ESM build (jest's VM can't
 * `import()` ESM without `--experimental-vm-modules`). It reproduces the exact
 * surface {@link PdfTextService.extract} drives — getDocument → getPage →
 * getTextContent — so the page-loop and item-joining logic get real coverage.
 * The live pdfjs path is validated at Node runtime, not here.
 *
 * Crucially the items mirror pdfjs's *real* shape: an explicit whitespace item
 * (`str: ' '`) marks every real space and a `hasEOL` item marks each line end —
 * bare glyph runs carry no space of their own. (An earlier fake space-joined all
 * items, which hid the CJK-spacing bug: real Korean is emitted one syllable
 * cluster per item, so a `join(' ')` shatters every word.)
 */
function fakePdfjs(pageItems: FakeItem[][]) {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageItems.length,
        async getPage(n: number) {
          return {
            async getTextContent() {
              return { items: pageItems[n - 1] };
            },
            cleanup() {},
          };
        },
        async destroy() {},
      }),
    }),
  } as unknown as Awaited<ReturnType<PdfTextService['loadModule']>>;
}

/** Word items separated by pdfjs's explicit space items, one line. */
function line(...words: string[]): FakeItem[] {
  const out: FakeItem[] = [];
  words.forEach((w, i) => {
    if (i > 0) out.push({ str: ' ' });
    out.push({ str: w });
  });
  out.push({ str: '', hasEOL: true });
  return out;
}

describe('PdfTextService', () => {
  it('reconstructs page text verbatim (real spaces kept, EOL → newline), 1-based', async () => {
    const service = new PdfTextService();
    service.loadModule = async () =>
      fakePdfjs([line('Party', 'A:', 'Acme'), line('Amount', '5,000,000', 'KRW')]);

    const pages = await service.extract(Buffer.from('%PDF-1.4'));
    expect(pages).toEqual([
      { page: 1, text: 'Party A: Acme\n' },
      { page: 2, text: 'Amount 5,000,000 KRW\n' },
    ]);
  });

  it('does NOT wedge spaces between per-glyph Korean items (the CJK-spacing bug)', async () => {
    const service = new PdfTextService();
    // pdfjs emits Korean one syllable cluster per item, with explicit spaces only
    // at real word breaks. Concatenating verbatim must reunite each word.
    service.loadModule = async () =>
      fakePdfjs([
        [
          { str: '주' },
          { str: '식' },
          { str: '회' },
          { str: '사' },
          { str: ' ' },
          { str: '위' },
          { str: '약' },
          { str: '금' },
          { str: '', hasEOL: true },
        ],
      ]);

    const pages = await service.extract(Buffer.from('%PDF-1.4'));
    expect(pages[0].text).toBe('주식회사 위약금\n');
  });

  it('returns [] (never throws) when the pdfjs module fails to load', async () => {
    const service = new PdfTextService();
    service.loadModule = async () => {
      throw new Error('cannot import ESM');
    };
    await expect(service.extract(Buffer.from('anything'))).resolves.toEqual([]);
  });

  it('returns [] (never throws) when parsing rejects', async () => {
    const service = new PdfTextService();
    service.loadModule = async () =>
      ({
        getDocument: () => ({
          promise: Promise.reject(new Error('not a pdf')),
        }),
      }) as unknown as Awaited<ReturnType<PdfTextService['loadModule']>>;
    await expect(service.extract(Buffer.from('junk'))).resolves.toEqual([]);
  });
});
