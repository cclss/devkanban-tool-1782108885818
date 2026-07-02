/**
 * Small HTTP response helpers shared across controllers.
 */

/**
 * Build a `Content-Disposition: attachment` header value that survives non-ASCII
 * (Korean) filenames. Emits both a sanitized ASCII `filename` fallback and the
 * RFC 5987 `filename*` UTF-8 form so every browser saves a sensible name.
 */
export function attachmentDisposition(filename: string): string {
  return disposition('attachment', filename);
}

/**
 * Build a `Content-Disposition: inline` header value (same non-ASCII handling as
 * {@link attachmentDisposition}). Used when bytes are meant to be rendered in
 * place (e.g. the editor's PDF preview) rather than downloaded.
 */
export function inlineDisposition(filename: string): string {
  return disposition('inline', filename);
}

function disposition(type: 'attachment' | 'inline', filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
