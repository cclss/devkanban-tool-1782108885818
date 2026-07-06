import { HeuristicFieldDetector } from './heuristic-field-detector';
import { SignFieldType } from '@repo/db';
import type {
  FieldCandidate,
  PdfPageText,
  PdfTextLayer,
  TextToken,
} from './field-detection.types';

// --- fixture builders --------------------------------------------------------

const PAGE_W = 595; // A4-ish, points
const PAGE_H = 842;

function tok(
  text: string,
  x: number,
  y: number,
  extra: Partial<TextToken> = {},
): TextToken {
  return { text, x, y, width: 40, height: 12, page: 1, ...extra };
}

function page(tokens: TextToken[], pageNo = 1, size = { width: PAGE_W, height: PAGE_H }): PdfPageText {
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

function typesOf(fields: FieldCandidate[]): SignFieldType[] {
  return fields.map((f) => f.type);
}

function inUnitBox(f: FieldCandidate): boolean {
  return (
    f.x >= 0 &&
    f.y >= 0 &&
    f.width > 0 &&
    f.height > 0 &&
    f.x + f.width <= 1 + 1e-9 &&
    f.y + f.height <= 1 + 1e-9
  );
}

describe('HeuristicFieldDetector', () => {
  const detector = new HeuristicFieldDetector();

  describe('text PDF → field candidates (type · coordinates · confidence)', () => {
    it('detects Signature, Date, and Text fields on a Korean form', () => {
      const result = detector.detect(
        layer(
          page([
            tok('계약서', 72, 780), // title, no match
            tok('성명:', 72, 700),
            tok('날짜:', 72, 660),
            tok('서명:', 72, 620),
          ]),
        ),
      );

      expect(result.engine).toBe('heuristic');
      expect(result.signal).toBe('ok');
      expect(result.fallbackToVision).toBe(false);
      expect(typesOf(result.fields).sort()).toEqual(
        [SignFieldType.DATE, SignFieldType.SIGNATURE, SignFieldType.TEXT].sort(),
      );
      // Each candidate carries coordinates, a type, and a confidence in (0,1].
      for (const f of result.fields) {
        expect(inUnitBox(f)).toBe(true);
        expect(f.confidence).toBeGreaterThan(0);
        expect(f.confidence).toBeLessThanOrEqual(1);
      }
      expect(result.meanConfidence).not.toBeNull();
      expect(result.meanConfidence as number).toBeGreaterThan(0.55);
    });

    it('detects English labels (Name / Date / Signature)', () => {
      const result = detector.detect(
        layer(
          page([
            tok('Name', 72, 700),
            tok('Date', 72, 660),
            tok('Signature', 72, 620, { width: 70 }),
          ]),
        ),
      );

      expect(result.signal).toBe('ok');
      expect(typesOf(result.fields).sort()).toEqual(
        [SignFieldType.DATE, SignFieldType.SIGNATURE, SignFieldType.TEXT].sort(),
      );
    });

    it('places the field to the right of its label, on the same page', () => {
      const label = tok('서명', 72, 700, { width: 30 });
      const result = detector.detect(layer(page([label])));

      expect(result.fields).toHaveLength(1);
      const f = result.fields[0];
      expect(f.type).toBe(SignFieldType.SIGNATURE);
      expect(f.page).toBe(1);
      // Placed to the right of the label's left edge.
      expect(f.x).toBeGreaterThan(label.x / PAGE_W);
      expect(inUnitBox(f)).toBe(true);
    });

    it('gives a Signature field a taller box than a Text field', () => {
      const sig = detector.detect(layer(page([tok('서명', 72, 700)]))).fields[0];
      const text = detector.detect(layer(page([tok('성명', 72, 700)]))).fields[0];
      expect(sig.height).toBeGreaterThan(text.height);
    });

    it('raises confidence when a colon cue is present', () => {
      const plain = detector.detect(layer(page([tok('서명', 72, 700)]))).fields[0];
      const colon = detector.detect(layer(page([tok('서명:', 72, 700)]))).fields[0];
      expect(colon.confidence).toBeGreaterThan(plain.confidence);
    });

    it('tags candidates with the correct page across a multi-page document', () => {
      const result = detector.detect(
        layer(
          page([tok('서명', 72, 700)], 1),
          page([tok('날짜', 72, 700)], 2),
        ),
      );
      const byPage = Object.fromEntries(result.fields.map((f) => [f.page, f.type]));
      expect(byPage[1]).toBe(SignFieldType.SIGNATURE);
      expect(byPage[2]).toBe(SignFieldType.DATE);
    });

    it('drops the field below the label when the right margin is tight', () => {
      // Wide label whose right edge leaves no room, but whose left edge does.
      const label = tok('서명', 470, 700, { width: 60 });
      const result = detector.detect(layer(page([label])));
      expect(result.fields).toHaveLength(1);
      const f = result.fields[0];
      // Below the label (smaller y in bottom-left origin) and left-aligned to it.
      expect(f.y).toBeLessThan(label.y / PAGE_H);
      expect(f.x).toBeCloseTo(label.x / PAGE_W, 5);
      expect(inUnitBox(f)).toBe(true);
    });

    it('keeps the higher-confidence field when candidates overlap', () => {
      // Two Signature cues at the exact same spot → identical boxes → deduped to
      // one, keeping the stronger (서명 0.9 over 자필 0.85).
      const result = detector.detect(
        layer(
          page([
            tok('서명', 72, 700, { width: 30 }), // SIGNATURE 0.9
            tok('자필', 72, 700, { width: 30 }), // SIGNATURE 0.85, same box
          ]),
        ),
      );
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].type).toBe(SignFieldType.SIGNATURE);
      expect(result.fields[0].confidence).toBeCloseTo(0.9, 5);
    });
  });

  describe('fallback signals', () => {
    it('returns no-text for an empty text layer (no pages)', () => {
      const result = detector.detect(layer());
      expect(result.signal).toBe('no-text');
      expect(result.fields).toEqual([]);
      expect(result.meanConfidence).toBeNull();
      expect(result.fallbackToVision).toBe(true);
    });

    it('returns no-text when pages carry no word-bearing runs (scanned/image-only)', () => {
      const result = detector.detect(
        layer(
          page([tok('', 72, 700), tok('   ', 72, 680), tok('•', 72, 660)]),
        ),
      );
      expect(result.signal).toBe('no-text');
      expect(result.fields).toEqual([]);
      expect(result.fallbackToVision).toBe(true);
    });

    it('returns low-confidence (no fields) when text exists but no labels match', () => {
      const result = detector.detect(
        layer(
          page([
            tok('이', 72, 700),
            tok('계약서는', 100, 700, { width: 60 }),
            tok('다음과', 170, 700, { width: 50 }),
            tok('같이', 230, 700),
            tok('체결한다', 270, 700, { width: 60 }),
          ]),
        ),
      );
      expect(result.signal).toBe('low-confidence');
      expect(result.fields).toEqual([]);
      expect(result.meanConfidence).toBeNull();
      expect(result.fallbackToVision).toBe(true);
    });

    it('flags low-confidence but still returns fields when only weak cues match', () => {
      const result = detector.detect(
        layer(
          page([
            tok('소속', 72, 700), // TEXT 0.5 (weak)
            tok('직위', 72, 640), // TEXT 0.5 (weak)
          ]),
        ),
      );
      expect(result.signal).toBe('low-confidence');
      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.fallbackToVision).toBe(true);
      expect(result.meanConfidence as number).toBeLessThan(0.55);
    });
  });
});
