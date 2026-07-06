/**
 * Shared Korean-font utility for server-generated PDFs.
 *
 * `pdf-lib` ships only the 14 standard (Latin-only) fonts, so any Hangul drawn
 * with them renders as tofu (□). To render Korean we must embed a real TTF via
 * `@pdf-lib/fontkit`. This module is the single place that:
 *
 *   1. loads the bundled Nanum Gothic TTF bytes (cached after first read), and
 *   2. embeds + caches that font into a given `PDFDocument`.
 *
 * It is intentionally framework-free (no Nest decorators) so both the signed-PDF
 * service (grain-2) and the audit-certificate service (grain-3) reuse it.
 *
 * Font choice: Nanum Gothic is the embeddable representative of the Design Spec
 * `typography` gothic role (`font-family-sans-pdf`) and is consistent with the
 * Nanum family already used for the serif/script roles. See `fonts/NOTICE.md`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from 'pdf-lib';

/** File name of the bundled Korean gothic TTF (see `fonts/NOTICE.md`). */
export const KOREAN_FONT_FILE = 'NanumGothic-Regular.ttf';

/**
 * Absolute path to the bundled TTF. Resolved relative to this module so it works
 * both from `src` (ts-jest / dev) and from `dist` (the build copies `fonts/**`
 * via `nest-cli.json` assets).
 */
export function koreanFontPath(): string {
  return join(__dirname, 'fonts', KOREAN_FONT_FILE);
}

// Read the ~2 MB TTF at most once per process; it never changes at runtime.
let cachedFontBytes: Uint8Array | undefined;

/** Bundled Korean gothic TTF bytes (cached after the first read). */
export function loadKoreanFontBytes(): Uint8Array {
  if (!cachedFontBytes) {
    cachedFontBytes = new Uint8Array(readFileSync(koreanFontPath()));
  }
  return cachedFontBytes;
}

/**
 * `WeakMap` so an embedded font is reused for repeated draws on the same
 * document, and the cache is released automatically when the document is GC'd.
 */
const embeddedByDoc = new WeakMap<PDFDocument, PDFFont>();

/**
 * Embed (and cache) the Korean gothic font into `doc`, returning the `PDFFont`.
 *
 * Registers fontkit on the document first (idempotent — safe to call per doc)
 * and embeds with `subset: true` so only the glyphs actually drawn are written,
 * keeping the output small despite the large source TTF.
 */
export async function embedKoreanFont(doc: PDFDocument): Promise<PDFFont> {
  const cached = embeddedByDoc.get(doc);
  if (cached) return cached;

  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(loadKoreanFontBytes(), { subset: true });
  embeddedByDoc.set(doc, font);
  return font;
}
