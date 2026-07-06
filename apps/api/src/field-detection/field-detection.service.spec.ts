import { FieldDetectionService } from './field-detection.service';
import { HeuristicFieldDetector } from './heuristic-field-detector';
import { EmptyPdfTextExtractor, type PdfTextExtractor } from './pdf-text-extractor';
import { SignFieldType } from '@repo/db';
import type { PdfTextLayer } from './field-detection.types';

const TEXT_PDF: PdfTextLayer = {
  pages: [
    {
      page: 1,
      width: 595,
      height: 842,
      tokens: [
        { text: '서명:', page: 1, x: 72, y: 620, width: 40, height: 12 },
      ],
    },
  ],
};

function serviceWith(extractor: PdfTextExtractor): FieldDetectionService {
  return new FieldDetectionService(new HeuristicFieldDetector(), extractor);
}

describe('FieldDetectionService', () => {
  it('runs extraction + detection for a text PDF', async () => {
    const service = serviceWith({ extract: async () => TEXT_PDF });
    const result = await service.analyze(Buffer.from('%PDF-1.7 fake'));

    expect(result.engine).toBe('heuristic');
    expect(result.signal).toBe('ok');
    expect(result.fields.map((f) => f.type)).toContain(SignFieldType.SIGNATURE);
  });

  it('reports no-text (not an error) when extraction throws', async () => {
    const service = serviceWith({
      extract: async () => {
        throw new Error('corrupt stream');
      },
    });
    const result = await service.analyze(Buffer.from('garbage'));

    expect(result.signal).toBe('no-text');
    expect(result.fields).toEqual([]);
    expect(result.fallbackToVision).toBe(true);
  });

  it('reports no-text with the default (empty) extractor binding', async () => {
    const service = serviceWith(new EmptyPdfTextExtractor());
    const result = await service.analyze(Buffer.from('%PDF-1.7'));

    expect(result.signal).toBe('no-text');
    expect(result.fallbackToVision).toBe(true);
  });
});
