/**
 * Small HTTP response helpers shared across controllers.
 */

/**
 * Build a `Content-Disposition: attachment` header value that survives non-ASCII
 * (Korean) filenames. Emits both a sanitized ASCII `filename` fallback and the
 * RFC 5987 `filename*` UTF-8 form so every browser saves a sensible name.
 */
export function attachmentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
