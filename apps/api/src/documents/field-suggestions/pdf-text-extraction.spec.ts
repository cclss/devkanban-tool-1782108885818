import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { extractPdfTextLayer, type PageRect } from './pdf-text-extraction';

/** Where a piece of text is drawn on the generated fixture (pdf-lib coords). */
interface DrawnText {
  text: string;
  x: number; // bottom-left origin (pdf-lib), points
  y: number;
  size: number;
}

/**
 * Build a PDF whose pages carry the given text runs (a real text layer). Page
 * size is fixed so tests can reason about absolute coordinates. pdf-lib and the
 * extractor share the same bottom-left origin, so a run drawn at (x, y) should
 * come back with a bbox lower-left ≈ (x, y).
 */
async function makeTextPdf(
  pagesText: DrawnText[][],
  size: [number, number] = [300, 400],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const runs of pagesText) {
    const page = doc.addPage(size);
    for (const run of runs) {
      page.drawText(run.text, { x: run.x, y: run.y, size: run.size, font, color: rgb(0, 0, 0) });
    }
  }
  return Buffer.from(await doc.save());
}

/** Build an image-only / scanned-style PDF: shapes but no text layer at all. */
async function makeImageOnlyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawRectangle({ x: 10, y: 10, width: 100, height: 100, color: rgb(0.2, 0.4, 0.6) });
  page.drawCircle({ x: 150, y: 150, size: 30, color: rgb(0.8, 0.2, 0.2) });
  return Buffer.from(await doc.save());
}

/** Find the fragment whose text contains `needle` (fixtures use unique needles). */
function findFragment(
  fragments: { text: string; bbox: PageRect }[],
  needle: string,
): { text: string; bbox: PageRect } {
  const hit = fragments.find((f) => f.text.includes(needle));
  if (!hit) throw new Error(`no fragment containing "${needle}" in [${fragments.map((f) => f.text)}]`);
  return hit;
}

describe('extractPdfTextLayer', () => {
  it('returns page size and text fragments with in-page bounding boxes', async () => {
    const pdf = await makeTextPdf([
      [
        { text: 'Signature', x: 50, y: 40, size: 20 }, // near the bottom
        { text: 'Date', x: 200, y: 350, size: 12 }, // near the top
      ],
    ]);

    const { pages, hasTextLayer } = await extractPdfTextLayer(pdf);

    expect(hasTextLayer).toBe(true);
    expect(pages).toHaveLength(1);

    const [first] = pages;
    expect(first!.page).toBe(1); // 1-based
    expect(first!.width).toBe(300);
    expect(first!.height).toBe(400);
    expect(first!.rotation).toBe(0);

    const sig = findFragment(first!.fragments, 'Signature');
    const date = findFragment(first!.fragments, 'Date');

    // Baseline lower-left corner ≈ the draw origin (bottom-left origin, points).
    expect(sig.bbox.x).toBeCloseTo(50, 0);
    expect(sig.bbox.y).toBeCloseTo(40, 0);
    expect(date.bbox.x).toBeCloseTo(200, 0);
    expect(date.bbox.y).toBeCloseTo(350, 0);

    // Positive, plausible extents fully inside the page.
    for (const { bbox } of first!.fragments) {
      expect(bbox.width).toBeGreaterThan(0);
      expect(bbox.height).toBeGreaterThan(0);
      expect(bbox.x).toBeGreaterThanOrEqual(0);
      expect(bbox.y).toBeGreaterThanOrEqual(0);
      expect(bbox.x + bbox.width).toBeLessThanOrEqual(first!.width + 1);
      expect(bbox.y + bbox.height).toBeLessThanOrEqual(first!.height + 1);
    }
  });

  it('uses a bottom-left origin: lower text has a smaller y than higher text', async () => {
    const pdf = await makeTextPdf([
      [
        { text: 'BOTTOM', x: 30, y: 30, size: 14 },
        { text: 'TOP', x: 30, y: 360, size: 14 },
      ],
    ]);

    const { pages } = await extractPdfTextLayer(pdf);
    const bottom = findFragment(pages[0]!.fragments, 'BOTTOM');
    const top = findFragment(pages[0]!.fragments, 'TOP');

    // +y points UP: the visually lower run must have the smaller y.
    expect(bottom.bbox.y).toBeLessThan(top.bbox.y);
  });

  it('assigns fragments to the correct 1-based page across a multi-page document', async () => {
    const pdf = await makeTextPdf([
      [{ text: 'PageOneMarker', x: 40, y: 200, size: 16 }],
      [{ text: 'PageTwoMarker', x: 40, y: 200, size: 16 }],
    ]);

    const { pages } = await extractPdfTextLayer(pdf);

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(findFragment(pages[0]!.fragments, 'PageOneMarker')).toBeDefined();
    expect(findFragment(pages[1]!.fragments, 'PageTwoMarker')).toBeDefined();
    // No cross-contamination between pages.
    expect(pages[0]!.fragments.some((f) => f.text.includes('PageTwoMarker'))).toBe(false);
  });

  it('returns empty fragments (no text layer) for a scanned / image-only PDF', async () => {
    const pdf = await makeImageOnlyPdf();

    const { pages, hasTextLayer } = await extractPdfTextLayer(pdf);

    expect(hasTextLayer).toBe(false);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.fragments).toEqual([]);
    // Page geometry is still reported so a caller can reason about the page.
    expect(pages[0]!.width).toBe(200);
    expect(pages[0]!.height).toBe(200);
  });

  it('reports the unrotated media-box size and page rotation for a rotated page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.setRotation(degrees(90));
    page.drawText('RotatedField', { x: 50, y: 40, size: 18, font });
    const pdf = Buffer.from(await doc.save());

    const { pages } = await extractPdfTextLayer(pdf);

    // width/height are the *unrotated* media box (the space fragment coords live
    // in), not the 400×300 viewer-visible size; rotation is surfaced separately.
    expect(pages[0]!.width).toBe(300);
    expect(pages[0]!.height).toBe(400);
    expect(pages[0]!.rotation).toBe(90);

    const frag = findFragment(pages[0]!.fragments, 'RotatedField');
    expect(frag.bbox.x).toBeCloseTo(50, 0);
    expect(frag.bbox.y).toBeCloseTo(40, 0);
  });

  it('does not mutate or detach the caller buffer', async () => {
    const pdf = await makeTextPdf([[{ text: 'Stable', x: 20, y: 20, size: 12 }]]);
    const before = Buffer.from(pdf); // snapshot of the bytes
    const originalLength = pdf.length;

    await extractPdfTextLayer(pdf);

    expect(pdf.length).toBe(originalLength); // not detached to length 0
    expect(pdf.equals(before)).toBe(true); // bytes unchanged
  });

  it('normalizes and de-normalizes a fragment box round-trip with no axis flip', async () => {
    const pdf = await makeTextPdf([[{ text: 'RoundTrip', x: 60, y: 120, size: 16 }]]);
    const { pages } = await extractPdfTextLayer(pdf);
    const page = pages[0]!;
    const { bbox } = findFragment(page.fragments, 'RoundTrip');

    // The exact normalization grain-3 will apply: divide by the page size, no
    // y-flip (extraction shares the field-geometry bottom-left origin).
    const norm = {
      x: bbox.x / page.width,
      y: bbox.y / page.height,
      width: bbox.width / page.width,
      height: bbox.height / page.height,
    };
    // Normalized values are valid 0..1 ratios.
    for (const v of Object.values(norm)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    // De-normalizing restores the original page-space box exactly (lossless,
    // axis-consistent) — the contract grain-3 relies on.
    const back: PageRect = {
      x: norm.x * page.width,
      y: norm.y * page.height,
      width: norm.width * page.width,
      height: norm.height * page.height,
    };
    expect(back.x).toBeCloseTo(bbox.x, 6);
    expect(back.y).toBeCloseTo(bbox.y, 6);
    expect(back.width).toBeCloseTo(bbox.width, 6);
    expect(back.height).toBeCloseTo(bbox.height, 6);
  });
});
