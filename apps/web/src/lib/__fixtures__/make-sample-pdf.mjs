/**
 * Deterministic generator for `sample-text.pdf` — the real text-selectable PDF
 * fixture that `pdf-text.fixture.test.ts` drives `extractPagePhrases` against.
 *
 * Emitted with the standard Helvetica font (built-in pdfjs metrics, no embedded
 * font blob) so the bytes stay tiny, reviewable, and reproducible: re-running
 * this script produces the identical file. Regenerate with:
 *   node src/lib/__fixtures__/make-sample-pdf.mjs
 *
 * Layout (A4 595x842pt, bottom-left origin / y-up — the NormRect axis):
 *   Page 1 — four anchor-style label lines, well separated vertically:
 *     • "Full Name : John Doe"  emitted as TWO adjacent text objects on one
 *       baseline, to exercise the same-line merge into a SINGLE phrase.
 *     • "Signature", "Date : 2026-07-28", "Amount : USD 1,000".
 *   Page 2 — one heading line ("Second Page").
 *   Page 3 — NO content stream (a text-layer-less / blank page).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function page(mediaContentsRef, hasFont) {
  const res = hasFont ? '/Resources << /Font << /F1 7 0 R >> >>' : '/Resources << >>';
  const contents = mediaContentsRef ? ` /Contents ${mediaContentsRef} 0 R` : '';
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ${res}${contents} >>`;
}

function stream(content) {
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

// Page 1 content: separate BT/ET text objects. "Full Name" + ": John Doe" share
// baseline y=700 so the extractor merges them into one phrase.
const page1 = [
  'BT /F1 20 Tf 100 760 Td (Signature) Tj ET',
  'BT /F1 20 Tf 100 700 Td (Full Name) Tj ET',
  'BT /F1 20 Tf 230 700 Td (: John Doe) Tj ET',
  'BT /F1 20 Tf 100 640 Td (Date : 2026-07-28) Tj ET',
  'BT /F1 20 Tf 100 580 Td (Amount : USD 1,000) Tj ET',
].join('\n');
const page2 = 'BT /F1 20 Tf 100 760 Td (Second Page) Tj ET';

const objs = [];
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objs[2] = '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>';
objs[3] = page(8, true); // page 1
objs[4] = page(9, true); // page 2
objs[5] = page(null, false); // page 3 — no contents (blank)
objs[6] = null; // (unused slot kept for readability)
objs[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
objs[8] = stream(page1);
objs[9] = stream(page2);

// Compact: drop the null slot by renumbering — build sequential object list.
const seq = [];
const map = {};
[1, 2, 3, 4, 5, 7, 8, 9].forEach((oldId, idx) => { map[oldId] = idx + 1; seq.push(objs[oldId]); });
// Rewrite cross-references to the new sequential ids.
function remap(s) {
  return s.replace(/(\d+) 0 R/g, (_, id) => `${map[Number(id)]} 0 R`);
}
const body = seq.map(remap);

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 0; i < body.length; i++) {
  offsets[i] = pdf.length;
  pdf += `${i + 1} 0 obj\n${body[i]}\nendobj\n`;
}
const size = body.length + 1;
const xrefStart = pdf.length;
pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
for (let i = 0; i < body.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${size} /Root ${map[1]} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

const out = fileURLToPath(new URL('./sample-text.pdf', import.meta.url));
writeFileSync(out, Buffer.from(pdf, 'latin1'));
console.log(`wrote ${out} (${pdf.length} bytes)`);
