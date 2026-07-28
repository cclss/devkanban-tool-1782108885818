/**
 * Real-PDF integration test for {@link extractPagePhrases}.
 *
 * Where `pdf-text.test.ts` exercises the merge math over synthetic PDF-point
 * items, this test drives the *whole* pipeline against an actual text-selectable
 * PDF (`__fixtures__/sample-text.pdf`, produced by `make-sample-pdf.mjs`) parsed
 * by the real pdfjs runtime. It proves the spec's completion criterion end-to-end
 * — "feed any text PDF → per-page phrase list + each phrase's position in the
 * field coordinate format" — with pdfjs's own text-content combining and
 * synthetic-whitespace items in the loop, which synthetic items can't reproduce.
 *
 * The document is opened with pdfjs's Node-friendly legacy build (no DOM, no
 * self-hosted worker path) and handed to `extractPagePhrases` unchanged — the
 * library API is untouched; only its input origin differs from production.
 *
 * Fixture layout (see make-sample-pdf.mjs):
 *   Page 1 — "Signature", "Full Name : John Doe" (two text objects that must
 *            merge to ONE phrase), "Date : 2026-07-28", "Amount : USD 1,000".
 *   Page 2 — "Second Page".
 *   Page 3 — no content stream (blank / text-layer-less page).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { extractPagePhrases, type PagePhrases, type TextItemLike } from './pdf-text';
import type { NormRect } from './field-geometry';

const FIXTURES = path.join(__dirname, '__fixtures__');
const DUMPER = path.join(FIXTURES, 'dump-text-content.mjs');

interface DumpedPage {
  page: number;
  view: [number, number, number, number];
  items: TextItemLike[];
}

/**
 * Parse the real PDF fixture with the actual pdfjs runtime and return a document
 * handle over its genuine text-content items.
 *
 * pdfjs-dist v4 is ESM-only and Jest's VM sandbox can't load it in-process, so
 * the parse runs in a plain Node subprocess (`dump-text-content.mjs`) whose JSON
 * output — the exact `getTextContent()` items and mediabox pdfjs produces — backs
 * this document. `extractPagePhrases` then runs, unmodified, over real geometry:
 * the same code path production takes, fed the same item shape a browser pdfjs
 * hands it. `getPage`/`view`/`getTextContent`/`cleanup` are the only members the
 * library touches, all present here.
 */
function loadFixtureDoc(): Parameters<typeof extractPagePhrases>[0] {
  const raw = execFileSync('node', [DUMPER], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const dump = JSON.parse(raw) as { numPages: number; pages: DumpedPage[] };
  const byPage = new Map(dump.pages.map((p) => [p.page, p]));
  const doc = {
    numPages: dump.numPages,
    getPage: async (n: number) => {
      const p = byPage.get(n);
      return {
        view: p?.view ?? [0, 0, 0, 0],
        getTextContent: async () => ({ items: p?.items ?? [] }),
        cleanup: () => {},
      };
    },
  };
  return doc as unknown as Parameters<typeof extractPagePhrases>[0];
}

/** Assert a rect satisfies the stored-field contract (M2, M5): 0..1, in-bounds. */
function expectFieldRect(rect: NormRect) {
  const eps = 1e-3; // spec ε
  for (const v of [rect.x, rect.y, rect.width, rect.height]) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
  expect(rect.x + rect.width).toBeLessThanOrEqual(1 + eps);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1 + eps);
  // Exactly the SignFieldDto keys — assignable to a stored field with no mapping.
  expect(Object.keys(rect).sort()).toEqual(['height', 'width', 'x', 'y']);
}

describe('extractPagePhrases — real text PDF fixture', () => {
  let pages: PagePhrases[];

  beforeAll(async () => {
    pages = await extractPagePhrases(loadFixtureDoc());
  });

  it('returns one entry per page, ascending (M9: length = pageCount)', () => {
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });

  it('extracts ≥1 phrase from every text-bearing page (M1)', () => {
    expect(pages[0]!.phrases.length).toBeGreaterThanOrEqual(1);
    expect(pages[1]!.phrases.length).toBeGreaterThanOrEqual(1);
  });

  it('gives every phrase a field-compatible NormRect in 0..1 and non-empty text (M2/M3/M5/M6)', () => {
    const all = pages.flatMap((p) => p.phrases);
    expect(all.length).toBeGreaterThan(0);
    for (const phrase of all) {
      expect(phrase.text.trim().length).toBeGreaterThanOrEqual(1);
      expect(phrase.page).toBeGreaterThanOrEqual(1);
      expectFieldRect(phrase.rect);
    }
  });

  it('merges a label split across pdfjs items into a SINGLE phrase (merge accuracy)', () => {
    const texts = pages[0]!.phrases.map((p) => p.text);
    // "Full Name" and ": John Doe" are separate text objects (plus a synthetic
    // whitespace item) on one baseline — they must collapse to one phrase, and
    // the fragments must NOT appear as their own phrases.
    expect(texts).toContain('Full Name : John Doe');
    expect(texts).not.toContain('Full Name');
    expect(texts).not.toContain(': John Doe');
    // Each of the four visual lines is exactly one phrase.
    expect(texts).toEqual([
      'Signature',
      'Full Name : John Doe',
      'Date : 2026-07-28',
      'Amount : USD 1,000',
    ]);
  });

  it('positions phrases bottom-left / y-up: higher lines get a larger y (M3)', () => {
    const p = pages[0]!.phrases;
    const sig = p.find((x) => x.text === 'Signature')!; // top line (y=760pt)
    const amount = p.find((x) => x.text.startsWith('Amount'))!; // bottom line (y=580pt)
    expect(sig.rect.y).toBeGreaterThan(amount.rect.y);
  });

  it('returns phrases: [] for a text-layer-less page without throwing (M7)', () => {
    expect(pages[2]!.phrases).toEqual([]);
  });
});
