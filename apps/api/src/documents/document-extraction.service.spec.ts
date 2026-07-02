import { BadRequestException } from '@nestjs/common';
import { DocumentFormat } from '@repo/db';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';
import {
  DocumentExtractionService,
  type ExtractedDocument,
} from './document-extraction.service';

/** Build a 2-page PDF with text at known media-box coordinates. */
async function buildSamplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([600, 800]);
  p1.drawText('Signature here', { x: 100, y: 700, size: 14, font });
  p1.drawText('Date field', { x: 100, y: 100, size: 12, font });

  const p2 = doc.addPage([400, 500]);
  p2.drawText('Page two text', { x: 50, y: 250, size: 10, font });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/** Assemble a minimal but valid DOCX (OOXML) package from parts. */
function buildDocx(opts: {
  paragraphs: string[];
  pageW?: number; // twips
  pageH?: number; // twips
  margin?: number; // twips
  fontHalfPt?: number;
  cachedPages?: number;
}): Buffer {
  const {
    paragraphs,
    pageW = 12240,
    pageH = 15840,
    margin = 1440,
    fontHalfPt = 22,
    cachedPages,
  } = opts;

  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:pPr><w:rPr><w:sz w:val="${fontHalfPt}"/></w:rPr></w:pPr>` +
        `<w:r><w:rPr><w:sz w:val="${fontHalfPt}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    )
    .join('');

  const sectPr =
    `<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"/>` +
    `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}"/></w:sectPr>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/></Types>`;

  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    'word/document.xml': strToU8(documentXml),
  };
  if (cachedPages != null) {
    entries['docProps/app.xml'] = strToU8(
      `<?xml version="1.0"?><Properties><Pages>${cachedPages}</Pages></Properties>`,
    );
  }

  return Buffer.from(zipSync(entries));
}

describe('DocumentExtractionService — PDF', () => {
  const service = new DocumentExtractionService();
  let extracted: ExtractedDocument;

  beforeAll(async () => {
    extracted = await service.extract(await buildSamplePdf(), DocumentFormat.PDF);
  });

  it('returns one entry per page with the media-box size in points', () => {
    expect(extracted.pages).toHaveLength(2);
    expect(extracted.pages[0].index).toBe(0);
    expect(extracted.pages[0].pageSize).toEqual({ width: 600, height: 800 });
    expect(extracted.pages[1].pageSize).toEqual({ width: 400, height: 500 });
  });

  it('extracts text spans with normalized, bottom-left boxes', () => {
    const sig = extracted.pages[0].textSpans.find((s) => s.text.includes('Signature'));
    expect(sig).toBeDefined();
    // x = 100/600 ≈ 0.167 (from the left).
    expect(sig!.bbox.x).toBeCloseTo(100 / 600, 2);
    // Baseline y = 700 → high up the page (bottom-left origin).
    expect(sig!.bbox.y).toBeGreaterThan(0.85);
    expect(sig!.bbox.y).toBeLessThan(0.9);
    expect(sig!.bbox.width).toBeGreaterThan(0);
    expect(sig!.bbox.height).toBeGreaterThan(0);

    // The near-bottom field sits low on the page.
    const date = extracted.pages[0].textSpans.find((s) => s.text.includes('Date'));
    expect(date).toBeDefined();
    expect(date!.bbox.y).toBeLessThan(0.15);
  });

  it('keeps every box within the 0..1 normalized range', () => {
    for (const page of extracted.pages) {
      for (const span of page.textSpans) {
        for (const v of [span.bbox.x, span.bbox.y, span.bbox.width, span.bbox.height]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('counts pages via the lightweight structural reader', async () => {
    const count = await service.countPages(await buildSamplePdf(), DocumentFormat.PDF);
    expect(count).toBe(2);
  });

  it('rejects corrupt PDF bytes', async () => {
    await expect(
      service.extract(Buffer.from('%PDF-not-really-a-pdf'), DocumentFormat.PDF),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DocumentExtractionService — DOCX', () => {
  const service = new DocumentExtractionService();

  it('lays out paragraphs into normalized boxes on a sized page', async () => {
    const bytes = buildDocx({
      paragraphs: ['First paragraph line', 'Second paragraph'],
      cachedPages: 1,
    });
    const result = await service.extract(bytes, DocumentFormat.DOCX);

    expect(result.pages).toHaveLength(1);
    // 12240 x 15840 twips → 612 x 792 pt (US Letter).
    expect(result.pages[0].pageSize).toEqual({ width: 612, height: 792 });

    const spans = result.pages[0].textSpans;
    expect(spans[0].text).toBe('First paragraph line');
    expect(spans[1].text).toBe('Second paragraph');

    // Left margin 1440 twips = 72pt → x = 72/612 ≈ 0.118.
    expect(spans[0].bbox.x).toBeCloseTo(72 / 612, 2);
    // First line near the top of the page (bottom-left origin).
    expect(spans[0].bbox.y).toBeGreaterThan(0.85);
    // Second paragraph sits below the first.
    expect(spans[1].bbox.y).toBeLessThan(spans[0].bbox.y);

    for (const span of spans) {
      for (const v of [span.bbox.x, span.bbox.y, span.bbox.width, span.bbox.height]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('decodes XML entities in run text', async () => {
    const bytes = buildDocx({ paragraphs: ['A &amp; B &lt;x&gt;'] });
    const result = await service.extract(bytes, DocumentFormat.DOCX);
    expect(result.pages[0].textSpans[0].text).toBe('A & B <x>');
  });

  it('paginates long content across multiple pages', async () => {
    // Many short paragraphs on a small page force pagination.
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`);
    const bytes = buildDocx({
      paragraphs,
      pageH: 3000, // ~150pt tall → only a few lines fit
      margin: 720,
    });
    const result = await service.extract(bytes, DocumentFormat.DOCX);
    expect(result.pages.length).toBeGreaterThan(1);
    result.pages.forEach((page, i) => expect(page.index).toBe(i));
  });

  it('prefers the cached <Pages> count, else falls back to layout', async () => {
    const withCache = buildDocx({ paragraphs: ['Only one line'], cachedPages: 7 });
    await expect(service.countPages(withCache, DocumentFormat.DOCX)).resolves.toBe(7);

    const noCache = buildDocx({
      paragraphs: Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`),
      pageH: 3000,
      margin: 720,
    });
    const laidOut = await service.countPages(noCache, DocumentFormat.DOCX);
    expect(laidOut).toBeGreaterThan(1);
  });

  it('rejects a DOCX package missing word/document.xml', async () => {
    const bytes = Buffer.from(zipSync({ 'other.xml': strToU8('<x/>') }));
    await expect(service.extract(bytes, DocumentFormat.DOCX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects bytes that are not a valid ZIP', async () => {
    await expect(
      service.extract(Buffer.from('not a zip at all'), DocumentFormat.DOCX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults to A4 + 1-inch margins when sectPr is absent', async () => {
    // Hand-build a document.xml with no sectPr.
    const documentXml =
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = Buffer.from(
      zipSync({ 'word/document.xml': strToU8(documentXml) }),
    );
    const result = await service.extract(bytes, DocumentFormat.DOCX);
    expect(result.pages[0].pageSize.width).toBeCloseTo(595.32, 1);
    expect(result.pages[0].pageSize.height).toBeCloseTo(841.92, 1);
  });
});
