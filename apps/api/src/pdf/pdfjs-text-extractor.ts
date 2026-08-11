import { Injectable, Logger } from '@nestjs/common';
import type { PageText, PdfTextExtractor } from './clause-extraction.types';

/**
 * ESM-only dynamic import that survives TypeScript's CommonJS downleveling.
 *
 * `pdfjs-dist` v4 ships ESM only. Under `module: CommonJS`, a plain `import()`
 * would be rewritten to `require()`, which cannot load an ESM package. Wrapping
 * the import in `new Function` hides it from the transpiler so a genuine dynamic
 * `import()` reaches Node (20+), which loads ESM from CommonJS just fine.
 */
const importESM = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<any>;

/**
 * The single place that touches `pdfjs-dist`. It fulfils {@link PdfTextExtractor}
 * by loading the **legacy** Node build (no DOM / worker assumptions) and reading
 * each page's text content into a {@link PageText}.
 *
 * All selection logic lives in the pure heuristics behind this boundary, so this
 * wrapper stays deliberately thin: bytes in, per-page text out. It swallows
 * nothing — a genuinely corrupt PDF rejects, and the service above decides that
 * a failed extraction means "no cards" rather than an error surfaced to the
 * signer.
 */
@Injectable()
export class PdfjsTextExtractor implements PdfTextExtractor {
  private readonly logger = new Logger(PdfjsTextExtractor.name);

  async extractPages(pdf: Buffer): Promise<PageText[]> {
    const pdfjs = await importESM('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdf),
      // Server-side render: no eval, no external font fetches, no worker.
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const doc = await loadingTask.promise;
    try {
      const pages: PageText[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        try {
          const content = await page.getTextContent();
          const text = content.items
            .map((item: unknown) =>
              item && typeof item === 'object' && 'str' in item
                ? String((item as { str: unknown }).str)
                : '',
            )
            .join(' ');
          pages.push({ page: i, text });
        } finally {
          page.cleanup();
        }
      }
      return pages;
    } finally {
      await doc.cleanup();
      await doc.destroy();
    }
  }
}
