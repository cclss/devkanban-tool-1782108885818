/**
 * Parses `sample-text.pdf` with the *real* pdfjs runtime and prints, as JSON, the
 * per-page mediabox `view` plus every `getTextContent()` item (str/transform/
 * width/height/hasEOL) to stdout.
 *
 * Why a child process: pdfjs-dist v4 is ESM-only, and Jest's VM sandbox cannot
 * load it in-process (it would need --experimental-vm-modules, and ts-jest lowers
 * dynamic import to a require that can't eval the `.mjs` bundle). Running the
 * parse in a plain Node subprocess (native ESM) sidesteps that, so the fixture
 * test drives the actual library `extractPagePhrases` over genuine pdfjs geometry
 * — synthetic-whitespace items, same-line combining and all.
 *
 *   node src/lib/__fixtures__/dump-text-content.mjs [path-to-pdf]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = process.argv[2] ?? fileURLToPath(new URL('./sample-text.pdf', import.meta.url));
const bytes = new Uint8Array(readFileSync(target));

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
// verbosity 0 = errors only: pdfjs routes warnings through console.log (stdout),
// which would otherwise corrupt the JSON payload this script emits.
const doc = await pdfjs.getDocument({
  data: bytes,
  isEvalSupported: false,
  useSystemFonts: false,
  verbosity: 0,
}).promise;

const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  pages.push({
    page: p,
    view: page.view,
    items: content.items
      .filter((it) => typeof it.str === 'string' && Array.isArray(it.transform))
      .map((it) => ({
        str: it.str,
        transform: it.transform,
        width: it.width,
        height: it.height,
        hasEOL: it.hasEOL,
      })),
  });
  page.cleanup();
}
process.stdout.write(JSON.stringify({ numPages: doc.numPages, pages }));
