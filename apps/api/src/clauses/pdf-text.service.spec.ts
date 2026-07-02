import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  PdfTextService,
  DEFAULT_NON_TEXT_CHAR_THRESHOLD,
} from './pdf-text.service';

/**
 * Build a text PDF from `pages` (one string per page). Each page draws its text
 * with a standard Latin font, producing a real text layer pdf.js can extract.
 */
async function makeTextPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const body of pages) {
    const page = doc.addPage([600, 800]);
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      page.drawText(line, { x: 40, y: 760 - i * 18, size: 12, font });
    });
  }
  return Buffer.from(await doc.save());
}

/** Build a PDF whose only content is drawn shapes — no text layer at all. */
async function makeImageOnlyPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([400, 400]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 360,
      height: 360,
      color: rgb(0.15, 0.15, 0.15),
    });
    page.drawCircle({ x: 200, y: 200, size: 80, color: rgb(0.8, 0.2, 0.2) });
  }
  return Buffer.from(await doc.save());
}

describe('PdfTextService.extract', () => {
  const service = new PdfTextService();

  it('extracts per-page text from a multi-page text PDF, tagged with 1-based page numbers', async () => {
    const pdf = await makeTextPdf([
      'Termination clause: either party may terminate with 30 days written notice.',
      'Payment terms: all invoices are due within 14 days of receipt.',
    ]);

    const result = await service.extract(pdf);

    expect(result.status).toBe('TEXT');
    expect(result.reason).toBeUndefined();
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({ page: 1 });
    expect(result.pages[1]).toMatchObject({ page: 2 });
    expect(result.pages[0].text).toContain('Termination clause');
    expect(result.pages[0].text).toContain('30 days');
    expect(result.pages[1].text).toContain('due within 14 days');
    // Page 1's content must not bleed into page 2.
    expect(result.pages[1].text).not.toContain('Termination');
    expect(result.totalChars).toBeGreaterThan(DEFAULT_NON_TEXT_CHAR_THRESHOLD);
  });

  it('classifies an image-only PDF (no text layer) as non-text and returns an empty result', async () => {
    const pdf = await makeImageOnlyPdf(2);

    const result = await service.extract(pdf);

    expect(result.status).toBe('EMPTY');
    expect(result.reason).toBe('NON_TEXT');
    expect(result.pages).toEqual([]);
    expect(result.totalChars).toBeLessThan(DEFAULT_NON_TEXT_CHAR_THRESHOLD);
  });

  it('classifies a valid PDF with no drawn content as non-text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const pdf = Buffer.from(await doc.save());

    const result = await service.extract(pdf);

    expect(result.status).toBe('EMPTY');
    expect(result.reason).toBe('NON_TEXT');
    expect(result.pages).toEqual([]);
  });

  it('treats a document just below the character threshold as non-text', async () => {
    // "Section 1." → 9 non-whitespace chars, under the default threshold of 16.
    const pdf = await makeTextPdf(['Section 1.']);

    const result = await service.extract(pdf);

    expect(result.status).toBe('EMPTY');
    expect(result.reason).toBe('NON_TEXT');
    expect(result.totalChars).toBeLessThan(DEFAULT_NON_TEXT_CHAR_THRESHOLD);
  });

  it('honors a custom non-text character threshold', async () => {
    const pdf = await makeTextPdf(['Section 1.']); // 9 meaningful chars

    // With a low threshold the same short document now counts as text.
    const result = await service.extract(pdf, { nonTextCharThreshold: 5 });

    expect(result.status).toBe('TEXT');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toContain('Section 1.');
  });

  it('absorbs corrupt / non-PDF bytes as an empty parse-error result instead of throwing', async () => {
    const garbage = Buffer.from('this is definitely not a pdf file', 'utf8');

    const result = await service.extract(garbage);

    expect(result.status).toBe('EMPTY');
    expect(result.reason).toBe('PARSE_ERROR');
    expect(result.pages).toEqual([]);
    expect(result.totalChars).toBe(0);
  });

  it('absorbs a truncated PDF (valid header, broken body) as an empty result', async () => {
    const pdf = await makeTextPdf(['Some contract text that is long enough.']);
    // Keep the %PDF- header but lop off the cross-reference table / trailer.
    const truncated = pdf.subarray(0, 40);

    const result = await service.extract(truncated);

    expect(result.status).toBe('EMPTY');
    expect(result.pages).toEqual([]);
  });

  it('accepts a Uint8Array and does not mutate the caller’s buffer', async () => {
    const pdf = await makeTextPdf(['Confidentiality clause applies to both parties.']);
    const bytes = new Uint8Array(pdf);
    const snapshot = Uint8Array.from(bytes);

    const result = await service.extract(bytes);

    expect(result.status).toBe('TEXT');
    expect(bytes).toEqual(snapshot); // pdf.js worked on a copy, not our bytes
  });
});
