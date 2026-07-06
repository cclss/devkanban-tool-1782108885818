import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfjsPageRenderer, RENDER_SCALE } from './pdfjs-page-renderer';

/**
 * End-to-end tests for the real PDF page rasterizer (grain-2 renderer binding).
 *
 * The renderer is exercised on genuine PDFs built with `pdf-lib` — the same
 * approach the text extractor's spec uses. The behaviours asserted are the ones
 * the grain's Done criteria and the {@link PdfPageRenderer} port contract call
 * out:
 *   • a scanned / image-only page rasterizes to a PNG `VisionPageImage`;
 *   • reported dimensions are the page's PDF points (scale 1), independent of the
 *     higher-resolution raster;
 *   • multi-page documents render every page in order;
 *   • an unreadable document degrades to `[]` (no throw) so the orchestration
 *     resolves the Vision path as `unavailable` instead of crashing.
 */
describe('PdfjsPageRenderer — end-to-end on real PDFs', () => {
  const renderer = new PdfjsPageRenderer();

  /** A single-page "scan": a filled page with no text layer. */
  async function imageOnlyPdf(
    width = 612,
    height = 792,
  ): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([width, height]);
    // Vector furniture standing in for scanned pixels — no text drawn.
    page.drawRectangle({
      x: 40,
      y: 40,
      width: width - 80,
      height: height - 80,
      color: rgb(0.9, 0.9, 0.9),
    });
    page.drawRectangle({ x: 80, y: 120, width: 200, height: 24 });
    return Buffer.from(await doc.save());
  }

  async function twoPageTextPdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]);
    p1.drawText('Signature', { x: 100, y: 700, size: 12, font });
    const p2 = doc.addPage([612, 792]);
    p2.drawText('Date', { x: 100, y: 700, size: 12, font });
    return Buffer.from(await doc.save());
  }

  it('rasterizes an image-only page to a PNG VisionPageImage', async () => {
    const pages = await renderer.render(await imageOnlyPdf());

    expect(pages).toHaveLength(1);
    const [p] = pages;
    expect(p.page).toBe(1);
    expect(p.mimeType).toBe('image/png');
    // Reported dimensions are PDF points (scale 1), NOT the raster pixel size.
    expect(p.width).toBeCloseTo(612);
    expect(p.height).toBeCloseTo(792);
    // Real PNG bytes (magic header) with non-trivial content.
    expect(p.image.length).toBeGreaterThan(0);
    expect(p.image.subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('reports point dimensions independent of the higher-res raster', async () => {
    // A distinctly-sized page so the point dims can't be confused with pixels.
    const pages = await renderer.render(await imageOnlyPdf(300, 400));

    expect(pages).toHaveLength(1);
    // Points come straight off the scale-1 viewport, not scaled by RENDER_SCALE.
    expect(pages[0].width).toBeCloseTo(300);
    expect(pages[0].height).toBeCloseTo(400);
    expect(RENDER_SCALE).toBeGreaterThan(1); // raster is denser than points
  });

  it('renders every page of a multi-page document in order', async () => {
    const pages = await renderer.render(await twoPageTextPdf());

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    for (const p of pages) {
      expect(p.mimeType).toBe('image/png');
      expect(p.image.subarray(0, 4).toString('hex')).toBe('89504e47');
    }
  });

  it('degrades an unreadable document to [] (no throw)', async () => {
    // Not a PDF at all — pdf.js cannot open it. The port contract is an empty
    // array (an `unavailable` Vision path), never an exception.
    await expect(
      renderer.render(Buffer.from('this is not a pdf')),
    ).resolves.toEqual([]);
  });

  it('degrades an empty buffer to [] (no throw)', async () => {
    await expect(renderer.render(Buffer.alloc(0))).resolves.toEqual([]);
  });
});
