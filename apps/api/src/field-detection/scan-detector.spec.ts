import { ScanDetector, classifyScan } from './scan-detector';
import type { PdfPageText, PdfTextLayer, TextToken } from './field-detection.types';

// --- fixture builders --------------------------------------------------------

const PAGE_W = 595; // A4-ish, points
const PAGE_H = 842;

function tok(text: string, extra: Partial<TextToken> = {}): TextToken {
  return { text, x: 72, y: 700, width: 40, height: 12, page: 1, ...extra };
}

function page(
  tokens: TextToken[],
  pageNo = 1,
  size = { width: PAGE_W, height: PAGE_H },
): PdfPageText {
  return {
    page: pageNo,
    width: size.width,
    height: size.height,
    tokens: tokens.map((t) => ({ ...t, page: pageNo })),
  };
}

function layer(...pages: PdfPageText[]): PdfTextLayer {
  return { pages };
}

/** A page representing a real (if sparse) Korean signature form. */
function textForm(pageNo = 1): PdfPageText {
  return page(
    [
      tok('성명:', { y: 700 }),
      tok('날짜:', { y: 660 }),
      tok('서명:', { y: 620 }),
    ],
    pageNo,
  );
}

/** A scanned page: the image carries no extractable text layer. */
function scannedPage(pageNo = 1): PdfPageText {
  return page([], pageNo);
}

describe('ScanDetector / classifyScan', () => {
  describe('the core signal (Done-when)', () => {
    it('image-only PDF → "Vision 필요" (visionRequired)', () => {
      const result = classifyScan(layer(scannedPage(1), scannedPage(2)));

      expect(result.scanClass).toBe('image-only');
      expect(result.visionRequired).toBe(true);
      expect(result.visionRecommended).toBe(true);
      expect(result.textPageCount).toBe(0);
      expect(result.scannedPageCount).toBe(2);
      expect(result.scannedPageRatio).toBe(1);
    });

    it('text PDF → "불필요" (not visionRequired)', () => {
      const result = classifyScan(layer(textForm(1), textForm(2)));

      expect(result.scanClass).toBe('text');
      expect(result.visionRequired).toBe(false);
      expect(result.visionRecommended).toBe(false);
      expect(result.scannedPageCount).toBe(0);
      expect(result.scannedPageRatio).toBe(0);
    });

    it('the injectable wrapper returns the same verdict as the function', () => {
      const doc = layer(textForm(1));
      expect(new ScanDetector().detect(doc)).toEqual(classifyScan(doc));
    });
  });

  describe('empty / no text layer', () => {
    it('a layer with no pages reads as image-only (nothing to place on)', () => {
      const result = classifyScan(layer());
      expect(result.scanClass).toBe('image-only');
      expect(result.visionRequired).toBe(true);
      expect(result.pageCount).toBe(0);
      expect(result.scannedPageRatio).toBe(1);
    });

    it('tolerates a null/undefined layer', () => {
      const result = classifyScan(undefined as unknown as PdfTextLayer);
      expect(result.scanClass).toBe('image-only');
      expect(result.visionRequired).toBe(true);
    });
  });

  describe('per-page density thresholds', () => {
    it('classifies a page with only whitespace/punctuation as a scan', () => {
      // No token carries a letter or digit → no usable text layer.
      const result = classifyScan(
        layer(page([tok(''), tok('   '), tok('•'), tok('—')])),
      );
      expect(result.scanClass).toBe('image-only');
      expect(result.visionRequired).toBe(true);
      expect(result.pages[0].wordChars).toBe(0);
      expect(result.pages[0].classification).toBe('image');
    });

    it('treats a page whose only text is a lone page number as a scan (furniture below the char floor)', () => {
      const result = classifyScan(layer(page([tok('7')])));
      expect(result.pages[0].wordChars).toBe(1); // below pageMinTextChars (2)
      expect(result.pages[0].classification).toBe('image');
      expect(result.visionRequired).toBe(true);
    });

    it('keeps a sparse but genuine text page as text (single "서명:" label)', () => {
      const result = classifyScan(layer(page([tok('서명:')])));
      expect(result.pages[0].wordChars).toBe(2);
      expect(result.pages[0].classification).toBe('text');
      expect(result.scanClass).toBe('text');
      expect(result.visionRequired).toBe(false);
    });

    it('reports text coverage and whitespace ratio for a page', () => {
      const result = classifyScan(layer(textForm(1)));
      const report = result.pages[0];
      expect(report.wordTokens).toBe(3);
      expect(report.textCoverage).toBeGreaterThan(0);
      expect(report.textCoverage).toBeLessThan(1);
      expect(report.whitespaceRatio).toBeCloseTo(1 - report.textCoverage, 10);
    });

    it('coverage is 0 for an undimensioned page but classification still works', () => {
      const result = classifyScan(
        layer(page([tok('서명:')], 1, { width: 0, height: 0 })),
      );
      expect(result.pages[0].textCoverage).toBe(0);
      expect(result.pages[0].whitespaceRatio).toBe(1);
      expect(result.pages[0].classification).toBe('text');
    });
  });

  describe('boundary cases: mixed / partial scan', () => {
    it('a mix of text and scanned pages reads as "mixed"', () => {
      const result = classifyScan(
        layer(textForm(1), scannedPage(2), scannedPage(3), textForm(4)),
      );
      expect(result.scanClass).toBe('mixed');
      expect(result.textPageCount).toBe(2);
      expect(result.scannedPageCount).toBe(2);
      expect(result.scannedPageRatio).toBeCloseTo(0.5, 10);
    });

    it('mixed → Vision recommended but not required (heuristic can still use the text pages)', () => {
      const result = classifyScan(layer(textForm(1), scannedPage(2)));
      expect(result.scanClass).toBe('mixed');
      expect(result.visionRequired).toBe(false);
      expect(result.visionRecommended).toBe(true);
    });

    it('surfaces which specific pages are scanned', () => {
      const result = classifyScan(
        layer(textForm(1), scannedPage(2), textForm(3)),
      );
      const scanned = result.pages
        .filter((p) => p.classification === 'image')
        .map((p) => p.page);
      expect(scanned).toEqual([2]);
    });
  });

  describe('threshold overrides', () => {
    it('raising pageMinTextChars reclassifies a sparse page as a scan', () => {
      const doc = layer(page([tok('서명:')])); // wordChars = 2
      expect(classifyScan(doc).scanClass).toBe('text');
      expect(classifyScan(doc, { pageMinTextChars: 5 }).scanClass).toBe('image-only');
    });
  });
});
