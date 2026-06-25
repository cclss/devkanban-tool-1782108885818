import { PDFDocument, degrees } from 'pdf-lib';
import { SignedPdfService, type SignFieldInput } from './signed-pdf.service';

/** A 1×1 transparent PNG as a data URL — a minimal but valid signature image. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** Build a fresh source PDF; page 2 (when requested) carries a 90° rotation. */
async function makePdf(pages = 1, rotateSecond = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([600, 800]);
    if (i === 1 && rotateSecond) page.setRotation(degrees(90));
  }
  return Buffer.from(await doc.save());
}

describe('SignedPdfService.compose', () => {
  const service = new SignedPdfService();

  it('composites all three field types and returns a valid, larger PDF', async () => {
    const original = await makePdf(1);
    const fields: SignFieldInput[] = [
      { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.1, value: PNG_1X1 },
      { type: 'DATE', page: 1, x: 0.1, y: 0.3, width: 0.2, height: 0.04, value: '2026-06-23' },
      { type: 'TEXT', page: 1, x: 0.1, y: 0.5, width: 0.5, height: 0.05, value: '홍길동 (계약 동의)' },
    ];

    const out = await service.compose(original, fields);

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(original.length); // content was added
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it('renders Korean text without throwing (no tofu)', async () => {
    const original = await makePdf(1);
    const out = await service.compose(original, [
      { type: 'TEXT', page: 1, x: 0.1, y: 0.4, width: 0.6, height: 0.05, value: '대한민국 전자서명 완료' },
    ]);
    await expect(PDFDocument.load(out)).resolves.toBeDefined();
  });

  it('places fields on a rotated page without error and preserves page count', async () => {
    const original = await makePdf(2, true);
    const fields: SignFieldInput[] = [
      { type: 'TEXT', page: 2, x: 0.1, y: 0.1, width: 0.4, height: 0.05, value: '회전 페이지 서명' },
      { type: 'SIGNATURE', page: 2, x: 0.5, y: 0.5, width: 0.3, height: 0.1, value: PNG_1X1 },
    ];
    const out = await service.compose(original, fields);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('reuses the same signature image across pages (no error, valid output)', async () => {
    const original = await makePdf(2);
    const fields: SignFieldInput[] = [
      { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.1, value: PNG_1X1 },
      { type: 'SIGNATURE', page: 2, x: 0.1, y: 0.1, width: 0.3, height: 0.1, value: PNG_1X1 },
    ];
    const out = await service.compose(original, fields);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('skips empty-valued fields', async () => {
    const original = await makePdf(1);
    const out = await service.compose(original, [
      { type: 'TEXT', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.05, value: '   ' },
    ]);
    // Nothing drawn → output stays essentially the same size as the input.
    expect(out.length).toBeLessThanOrEqual(original.length + 200);
  });

  it('throws on an out-of-range page index', async () => {
    const original = await makePdf(1);
    await expect(
      service.compose(original, [
        { type: 'TEXT', page: 5, x: 0.1, y: 0.1, width: 0.3, height: 0.05, value: 'x' },
      ]),
    ).rejects.toThrow(/page 5/);
  });

  it('throws on a non-image signature value', async () => {
    const original = await makePdf(1);
    await expect(
      service.compose(original, [
        { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.1, value: 'not-a-data-url' },
      ]),
    ).rejects.toThrow(/data URL/);
  });

  it('throws on an unsupported signature image type', async () => {
    const original = await makePdf(1);
    await expect(
      service.compose(original, [
        {
          type: 'SIGNATURE',
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.1,
          value: 'data:image/webp;base64,AAAA',
        },
      ]),
    ).rejects.toThrow(/Unsupported/);
  });
});
