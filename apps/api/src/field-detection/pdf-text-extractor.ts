import { Injectable } from '@nestjs/common';
import type { PdfTextLayer } from './field-detection.types';

/**
 * Port that turns raw PDF bytes into a positioned {@link PdfTextLayer} — the
 * only input the heuristic detector needs. It is a separate seam because
 * extracting positioned text from a PDF is a distinct concern (and the natural
 * place a real parser plugs in) from the language/geometry heuristics that act
 * on the result. Keeping it behind a token lets the detector be fixture-tested
 * with hand-authored text layers, and lets grain-3/grain-4 bind a concrete
 * extractor without touching the detection logic.
 */
export interface PdfTextExtractor {
  /**
   * Extract every page's positioned text runs. Implementations should return an
   * empty `pages` array (rather than throw) for an image-only / scanned PDF that
   * carries no text layer, so the detector reports the `no-text` fallback.
   */
  extract(pdf: Buffer): Promise<PdfTextLayer>;
}

/** DI token for the {@link PdfTextExtractor} binding. */
export const PDF_TEXT_EXTRACTOR = Symbol('PDF_TEXT_EXTRACTOR');

/**
 * Default extractor binding: reports "no text layer" for every input.
 *
 * The heuristic engine is deliberately decoupled from any specific PDF parser.
 * Until a positioned-text extractor is bound (grain-3/grain-4 orchestration),
 * this default makes every document look image-only, which routes cleanly to the
 * `no-text` fallback signal — no crashes, no silent wrong answers. Swap this
 * provider for a real extractor to enable end-to-end heuristic detection on text
 * PDFs.
 */
@Injectable()
export class EmptyPdfTextExtractor implements PdfTextExtractor {
  async extract(_pdf: Buffer): Promise<PdfTextLayer> {
    return { pages: [] };
  }
}
