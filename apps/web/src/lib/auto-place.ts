/**
 * Auto-placement orchestration: File → suggested field candidates.
 *
 * This is the single entry point the placement UI calls to "자동 배치" a text
 * PDF. It chains the three building blocks each other grain owns —
 *   1. `openPdf`            (pdf.ts)        — parse the File into a pdfjs document
 *   2. `extractPagePhrases` (pdf-text.ts)   — per-page phrases + their positions
 *   3. `suggestFields`      (field-anchors) — classify anchors, place candidates
 * — and returns the recommended {@link FieldCandidate}s. It adds no new
 * placement logic of its own; it is pure orchestration plus resource cleanup.
 *
 * Failure contract (design-spec completion criterion "실패 시 수동 흐름 보장"):
 * a corrupt / non-PDF file, a scanned / text-layer-less PDF, or any error while
 * walking the document degrades to `[]` — never a thrown exception. The caller
 * therefore treats "no suggestions" and "auto-place failed" identically: the
 * manual placement flow simply carries on with zero recommended fields, and the
 * screen never breaks.
 *
 * Resource safety: the pdfjs document holds worker-side resources, so once it is
 * open `doc.destroy()` always runs — on the success path, on an extraction
 * error, and regardless of how many phrases were found. `openPdf` throwing means
 * no document was ever created, so there is nothing to destroy in that case.
 */

import { suggestFields, type FieldCandidate } from './field-anchors';
import { openPdf } from './pdf';
import { extractPagePhrases } from './pdf-text';

export type { FieldCandidate } from './field-anchors';

/**
 * Run auto-placement over a text PDF and return the recommended field
 * candidates.
 *
 * Returns `[]` (never throws) when the file can't be parsed as a PDF, has no
 * selectable text layer, carries no recognizable anchor phrases, or errors
 * mid-extraction — so a caller can always fall back to manual placement. The
 * document is destroyed before returning whenever it was successfully opened.
 */
export async function autoPlaceFields(file: File): Promise<FieldCandidate[]> {
  let doc: Awaited<ReturnType<typeof openPdf>>['doc'];
  try {
    ({ doc } = await openPdf(file));
  } catch {
    // Corrupt / non-PDF: openPdf surfaces PdfRenderError. No document exists to
    // clean up; degrade to "no suggestions".
    return [];
  }

  try {
    const pages = await extractPagePhrases(doc);
    return suggestFields(pages);
  } catch {
    // Any failure while walking the opened document — treat as "no suggestions"
    // rather than propagating; manual placement stays available.
    return [];
  } finally {
    // The document was opened, so free worker-side resources on every path.
    void doc.destroy();
  }
}
