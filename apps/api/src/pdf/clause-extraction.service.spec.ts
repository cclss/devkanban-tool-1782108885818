import { ClauseExtractionService } from './clause-extraction.service';
import type { PageText, PdfTextExtractor } from './clause-extraction.types';

/** A fake extractor so the service is tested without touching `pdfjs-dist`. */
class FakeExtractor implements PdfTextExtractor {
  constructor(private readonly behavior: () => Promise<PageText[]>) {}
  extractPages(): Promise<PageText[]> {
    return this.behavior();
  }
}

function serviceReturning(pages: PageText[]): ClauseExtractionService {
  return new ClauseExtractionService(new FakeExtractor(async () => pages));
}

const SAMPLE = `제1조 (계약금액)
용역 대금은 50,000,000원으로 한다.

제2조 (지연배상)
지연 시 위약금을 배상한다.`;

describe('ClauseExtractionService', () => {
  it('returns structured clauses from extracted pages', async () => {
    const service = serviceReturning([{ page: 1, text: SAMPLE }]);
    const clauses = await service.extractFromPdf(Buffer.from('pdf'));
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    expect(clauses.length).toBeLessThanOrEqual(5);
    expect(clauses.some((c) => c.caution)).toBe(true);
    expect(clauses.some((c) => c.figures.some((f) => f.kind === 'money'))).toBe(true);
  });

  it('returns [] when the document has no usable text', async () => {
    const service = serviceReturning([{ page: 1, text: '' }]);
    expect(await service.extractFromPdf(Buffer.from('pdf'))).toEqual([]);
  });

  it('degrades to [] when extraction throws (no error surfaced)', async () => {
    const service = new ClauseExtractionService(
      new FakeExtractor(async () => {
        throw new Error('corrupt PDF');
      }),
    );
    await expect(service.extractFromPdf(Buffer.from('pdf'))).resolves.toEqual([]);
  });
});
