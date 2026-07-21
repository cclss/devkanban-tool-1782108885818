import { PdfTextService } from './pdf-text.service';

/**
 * A fake pdfjs module standing in for the real ESM build (jest's VM can't
 * `import()` ESM without `--experimental-vm-modules`). It reproduces the exact
 * surface {@link PdfTextService.extract} drives — getDocument → getPage →
 * getTextContent — so the page-loop and item-joining logic get real coverage.
 * The live pdfjs path is validated at Node runtime, not here.
 */
function fakePdfjs(pageTexts: string[][]) {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageTexts.length,
        async getPage(n: number) {
          return {
            async getTextContent() {
              return { items: pageTexts[n - 1].map((str) => ({ str })) };
            },
            cleanup() {},
          };
        },
        async destroy() {},
      }),
    }),
  } as unknown as Awaited<ReturnType<PdfTextService['loadModule']>>;
}

describe('PdfTextService', () => {
  it('joins text items into one string per page, 1-based', async () => {
    const service = new PdfTextService();
    service.loadModule = async () =>
      fakePdfjs([
        ['Party', 'A:', 'Acme'],
        ['Amount', '5,000,000', 'KRW'],
      ]);

    const pages = await service.extract(Buffer.from('%PDF-1.4'));
    expect(pages).toEqual([
      { page: 1, text: 'Party A: Acme' },
      { page: 2, text: 'Amount 5,000,000 KRW' },
    ]);
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
