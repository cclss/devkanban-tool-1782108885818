/**
 * Pure text-extraction tests for `itemsToPhrases`.
 *
 * These pin the two things the auto-placement step rests on:
 *   • pdfjs run geometry → field-compatible NormRect (0..1, bottom-left origin,
 *     same shape `field-geometry.ts` produces), including the y-axis semantics,
 *   • same-baseline run merging into phrases (words join, columns and lines
 *     split), so anchor labels like "서명" or "성명" come out whole.
 *
 * All synthetic — no PDF, no worker, no DOM — mirroring `field-geometry.test.ts`.
 */

import { itemsToPhrases, type PdfTextEntry, type ViewportSize } from './pdf-text';

const A4: ViewportSize = { width: 595, height: 842 };

/** Build a pdfjs-shaped horizontal text run at a PDF-space origin (x, y). */
function run(
  str: string,
  x: number,
  y: number,
  width: number,
  height = 12,
  hasEOL = false,
): PdfTextEntry {
  return { str, transform: [height, 0, 0, height, x, y], width, height, hasEOL };
}

describe('itemsToPhrases — normalization', () => {
  it('maps a run to a 0..1 bottom-left NormRect by dividing by the viewport', () => {
    const phrase = itemsToPhrases([run('서명', 100, 742, 200, 20)], A4)[0]!;
    expect(phrase.text).toBe('서명');
    expect(phrase.rect.x).toBeCloseTo(100 / 595, 9);
    expect(phrase.rect.y).toBeCloseTo(742 / 842, 9);
    expect(phrase.rect.width).toBeCloseTo(200 / 595, 9);
    expect(phrase.rect.height).toBeCloseTo(20 / 842, 9);
  });

  it('uses a bottom-left origin: a run near the page bottom has a small y', () => {
    const low = itemsToPhrases([run('footer', 40, 30, 100, 12)], A4)[0]!;
    expect(low.rect.y).toBeCloseTo(30 / 842, 9);

    const high = itemsToPhrases([run('header', 40, 800, 100, 12)], A4)[0]!;
    expect(high.rect.y).toBeCloseTo(800 / 842, 9);
    expect(high.rect.y).toBeGreaterThan(low.rect.y);
  });

  it('keeps every coordinate within 0..1 (server/field-valid box)', () => {
    const phrase = itemsToPhrases([run('edge', 560, 820, 80, 40)], A4)[0]!;
    for (const v of [phrase.rect.x, phrase.rect.y, phrase.rect.width, phrase.rect.height]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('itemsToPhrases — run merging', () => {
  it('merges adjacent same-baseline runs into one phrase, inserting a space', () => {
    // "Hello" ends at x=150; "World" starts at 156 → gap 6 = 0.5*height → space.
    const phrases = itemsToPhrases(
      [run('Hello', 100, 400, 50, 12), run('World', 156, 400, 50, 12)],
      A4,
    );
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.text).toBe('Hello World');
    // Box spans both runs: left of the first to right of the second.
    expect(phrases[0]!.rect.x).toBeCloseTo(100 / 595, 9);
    expect(phrases[0]!.rect.width).toBeCloseTo((206 - 100) / 595, 9);
  });

  it('joins tight (near-zero gap) runs without inserting a space', () => {
    const phrases = itemsToPhrases(
      [run('금', 100, 400, 12, 12), run('액', 112, 400, 12, 12)],
      A4,
    );
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.text).toBe('금액');
  });

  it('splits a wide horizontal gap into separate phrases (two columns)', () => {
    // Second run starts far to the right → gap ≫ one height → new phrase.
    const phrases = itemsToPhrases(
      [run('이름', 60, 400, 40, 12), run('날짜', 400, 400, 40, 12)],
      A4,
    );
    expect(phrases.map((p) => p.text)).toEqual(['이름', '날짜']);
  });

  it('splits runs on different baselines into separate phrases (two lines)', () => {
    const phrases = itemsToPhrases(
      [run('line-one', 60, 400, 80, 12), run('line-two', 60, 360, 80, 12)],
      A4,
    );
    expect(phrases.map((p) => p.text)).toEqual(['line-one', 'line-two']);
  });

  it('breaks a phrase when a run flags end-of-line even if the next is adjacent', () => {
    const phrases = itemsToPhrases(
      [run('first', 60, 400, 40, 12, true), run('second', 104, 400, 40, 12)],
      A4,
    );
    expect(phrases.map((p) => p.text)).toEqual(['first', 'second']);
  });
});

describe('itemsToPhrases — filtering', () => {
  it('ignores marked-content markers that carry no geometry', () => {
    const entries: PdfTextEntry[] = [
      { type: 'beginMarkedContent' },
      run('시그니처', 100, 500, 60, 12),
      { type: 'endMarkedContent' },
    ];
    const phrases = itemsToPhrases(entries, A4);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.text).toBe('시그니처');
  });

  it('drops whitespace-only runs but honors their end-of-line break', () => {
    const phrases = itemsToPhrases(
      [
        run('name', 60, 400, 40, 12),
        run('   ', 100, 400, 8, 12, true),
        run('value', 120, 400, 50, 12),
      ],
      A4,
    );
    expect(phrases.map((p) => p.text)).toEqual(['name', 'value']);
  });

  it('returns no phrases for an empty or text-free page', () => {
    expect(itemsToPhrases([], A4)).toEqual([]);
    expect(itemsToPhrases([{ type: 'beginMarkedContent' }], A4)).toEqual([]);
  });
});
