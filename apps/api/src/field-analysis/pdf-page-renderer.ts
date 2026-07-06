import { Injectable } from '@nestjs/common';
import type { VisionPageImage } from '../vision-detection/vision-detection.types';

/**
 * Port that rasterizes a PDF's bytes into per-page images — the only input the
 * premium Vision engine consumes ({@link VisionPageImage}). It is a distinct seam
 * because rendering a PDF to images is a separate concern (and the natural place a
 * real renderer plugs in) from choosing *when* to run Vision, which is this
 * grain's job. Keeping it behind a token lets the orchestration be tested with
 * hand-authored page images and lets a later grain bind a concrete renderer
 * without touching the tiered-analysis logic.
 */
export interface PdfPageRenderer {
  /**
   * Render every page of a PDF to a raster image. Implementations should return
   * an empty array (rather than throw) when they cannot render — the
   * orchestration treats "no images" as an unavailable Vision path and never
   * charges a trial for it.
   */
  render(pdf: Buffer): Promise<VisionPageImage[]>;
}

/** DI token for the {@link PdfPageRenderer} binding. */
export const PDF_PAGE_RENDERER = Symbol('PDF_PAGE_RENDERER');

/**
 * Default renderer binding: renders nothing.
 *
 * The orchestration is deliberately decoupled from any specific PDF rasterizer.
 * Until a real renderer is bound, this default makes the Vision path report as
 * unavailable (no images to send), which the orchestration handles as a safe
 * `failed` stage with **no trial charged** — no crashes, no wrongly-spent trials.
 * Swap this provider for a real renderer to enable end-to-end Vision analysis on
 * image-only PDFs.
 */
@Injectable()
export class EmptyPdfPageRenderer implements PdfPageRenderer {
  async render(_pdf: Buffer): Promise<VisionPageImage[]> {
    return [];
  }
}
