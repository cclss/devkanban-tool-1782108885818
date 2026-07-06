import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  PdfjsTextExtractor,
  mapTextItem,
  multiplyMatrix,
  type Matrix,
  type TextItemLike,
  type ViewportLike,
} from './pdfjs-text-extractor';
import { classifyScan } from './scan-detector';
import { HeuristicFieldDetector } from './heuristic-field-detector';
import { SignFieldType } from '@repo/db';

/** A rotation-0 viewport transform at scale 1: flips y for a `H`-tall page. */
function uprightViewport(width: number, height: number): ViewportLike {
  return { width, height, transform: [1, 0, 0, -1, 0, height] };
}

describe('multiplyMatrix', () => {
  it('composes n-then-m like pdf.js Util.transform', () => {
    const identity: Matrix = [1, 0, 0, 1, 0, 0];
    const m: Matrix = [2, 0, 0, 3, 5, 7];
    expect(multiplyMatrix(identity, m)).toEqual(m);
    expect(multiplyMatrix(m, identity)).toEqual(m);
  });

  it('applies translation after the linear part', () => {
    // viewport(flip) ∘ item(baseline at 100,740) → visible-device baseline.
    const viewport: Matrix = [1, 0, 0, -1, 0, 792];
    const item: Matrix = [12, 0, 0, 12, 100, 740];
    expect(multiplyMatrix(viewport, item)).toEqual([12, 0, 0, -12, 100, 52]);
  });
});

describe('mapTextItem — top-left → bottom-left, point mapping', () => {
  const viewport = uprightViewport(612, 792);

  it('places a run by its bottom-left corner in PDF points', () => {
    // Baseline at (100, 740) from the bottom, size 12.
    const item: TextItemLike = {
      str: 'Signature',
      transform: [12, 0, 0, 12, 100, 740],
      width: 51.36,
      height: 12,
    };
    const token = mapTextItem(item, viewport, 1);
    expect(token).not.toBeNull();
    expect(token).toEqual({
      text: 'Signature',
      page: 1,
      x: 100,
      y: 740, // pageHeight(792) - deviceBaselineY(52)
      width: 51.36,
      height: 12,
    });
  });

  it('trims surrounding whitespace and drops empty runs', () => {
    const spaced: TextItemLike = {
      str: '  서명  ',
      transform: [10, 0, 0, 10, 72, 500],
      width: 20,
      height: 10,
    };
    expect(mapTextItem(spaced, viewport, 2)?.text).toBe('서명');

    const blank: TextItemLike = {
      str: '   ',
      transform: [10, 0, 0, 10, 0, 0],
      width: 0,
      height: 0,
    };
    expect(mapTextItem(blank, viewport, 1)).toBeNull();
  });

  it('honours the viewport transform (cropbox offset / rotation) for the flip', () => {
    // A page whose visible box is offset by 10pt in x (a non-zero cropbox).
    const offset: ViewportLike = {
      width: 200,
      height: 300,
      transform: [1, 0, 0, -1, -10, 300],
    };
    const item: TextItemLike = {
      str: 'Date',
      transform: [10, 0, 0, 10, 50, 250],
      width: 25,
      height: 10,
    };
    const token = mapTextItem(item, offset, 1);
    expect(token).toEqual({
      text: 'Date',
      page: 1,
      x: 40, // 50 shifted left by the 10pt cropbox offset
      y: 250, // 300 - deviceBaselineY(50)
      width: 25,
      height: 10,
    });
  });

  it('derives height from the transform scale when font height is present', () => {
    const item: TextItemLike = {
      str: 'x',
      transform: [0, 18, -18, 0, 100, 100], // 90°-rotated run, scale 18
      width: 9,
      height: 0,
    };
    // hypot of the linear column magnitudes → 18, regardless of orientation.
    expect(mapTextItem(item, uprightViewport(400, 600), 1)?.height).toBeCloseTo(
      18,
    );
  });
});

describe('PdfjsTextExtractor — end-to-end on real PDFs', () => {
  const extractor = new PdfjsTextExtractor();

  async function textPdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Signature', { x: 100, y: 700, size: 12, font });
    page.drawText('Date', { x: 100, y: 620, size: 12, font });
    page.drawText('Full Name', { x: 100, y: 540, size: 12, font });
    return Buffer.from(await doc.save());
  }

  async function imageOnlyPdf(): Promise<Buffer> {
    // No text drawn — only vector furniture, standing in for a scan.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 50, y: 50, width: 500, height: 692 });
    return Buffer.from(await doc.save());
  }

  it('extracts positioned, bottom-left tokens from a text PDF', async () => {
    const layer = await extractor.extract(await textPdf());
    expect(layer.pages).toHaveLength(1);
    const [p] = layer.pages;
    expect(p.width).toBeCloseTo(612);
    expect(p.height).toBeCloseTo(792);

    const sig = p.tokens.find((t) => t.text === 'Signature');
    expect(sig).toBeDefined();
    // Drawn at bottom-left y=700; the token's lower edge sits at the baseline.
    expect(sig!.x).toBeCloseTo(100, 0);
    expect(sig!.y).toBeCloseTo(700, 0);
    expect(sig!.height).toBeGreaterThan(0);
    expect(sig!.width).toBeGreaterThan(0);

    // Higher-on-the-page label has a larger bottom-left y (origin is the bottom).
    const date = p.tokens.find((t) => t.text === 'Date');
    expect(sig!.y).toBeGreaterThan(date!.y);
  });

  it('feeds the heuristic detector to real candidates on a text PDF', async () => {
    const layer = await extractor.extract(await textPdf());
    const result = new HeuristicFieldDetector().detect(layer);
    expect(result.signal).toBe('ok');
    expect(result.fields.length).toBeGreaterThan(0);
    const types = result.fields.map((f) => f.type);
    expect(types).toEqual(
      expect.arrayContaining([SignFieldType.SIGNATURE, SignFieldType.DATE]),
    );
  });

  it('degrades an image-only PDF to an empty text layer (no-text)', async () => {
    const layer = await extractor.extract(await imageOnlyPdf());
    expect(layer.pages).toHaveLength(1);
    expect(layer.pages[0].tokens).toEqual([]);
    // The scan detector reads the empty layer as image-only → vision required.
    expect(classifyScan(layer).scanClass).toBe('image-only');
    expect(new HeuristicFieldDetector().detect(layer).signal).toBe('no-text');
  });
});
