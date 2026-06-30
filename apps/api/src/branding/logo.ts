/**
 * Brand-logo format detection, size limits, and SVG sanitization.
 *
 * Pure helpers (no Nest / IO) so the security-critical bits — cross-checking
 * declared type against magic bytes, and stripping active content out of
 * uploaded SVGs — are unit-testable in isolation.
 */

/** Business size limit for an uploaded logo. Oversize → 400 (branding copy). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Absolute hard ceiling enforced by the multipart interceptor so a single
 * request can't exhaust memory. The *business* limit ({@link MAX_LOGO_BYTES})
 * is enforced in the service and is what produces the user-facing 400; this is
 * just an abuse backstop above it.
 */
export const LOGO_UPLOAD_CEILING_BYTES = 8 * 1024 * 1024; // 8MB

/** Guidance surfaced to admins; the upload itself only caps the byte size. */
export const RECOMMENDED_LOGO_NOTE =
  '권장 크기는 512×512px 내외의 정사각형 이미지예요. 최대 2MB까지 올릴 수 있어요.';

export type LogoFormat = 'png' | 'jpeg' | 'svg';

export interface UploadedLogo {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/** Declared MIME → format. Both common SVG/JPEG spellings are accepted. */
const MIME_FORMAT: Readonly<Record<string, LogoFormat>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/svg+xml': 'svg',
  'image/svg': 'svg',
};

/** File extension → format. */
const EXT_FORMAT: Readonly<Record<string, LogoFormat>> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  svg: 'svg',
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function mimeOf(raw: string): string {
  return (raw ?? '').toLowerCase().split(';')[0].trim();
}

function hasPngMagic(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function hasJpegMagic(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function looksLikeSvg(buf: Buffer): boolean {
  // SVG is text; the root <svg> element appears near the top (possibly after a
  // BOM, an <?xml …?> prolog, or a DOCTYPE). Sniff the first slice only.
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048)).toLowerCase();
  return head.includes('<svg');
}

function contentMatches(format: LogoFormat, buf: Buffer): boolean {
  if (format === 'png') return hasPngMagic(buf);
  if (format === 'jpeg') return hasJpegMagic(buf);
  return looksLikeSvg(buf);
}

/**
 * Resolve the logo's true format, or null if it isn't an allowed JPG/PNG/SVG.
 *
 * Defense in depth: the declared MIME and the filename extension must BOTH map
 * to the same format, AND the actual bytes must match that format (magic bytes
 * for raster, an `<svg` root for vector). A mismatch on any axis is rejected,
 * so a `.png`-named script or an `image/png`-labeled SVG never gets through.
 */
export function detectLogoFormat(file: UploadedLogo): LogoFormat | null {
  if (!file?.buffer || file.buffer.length === 0) return null;
  const byMime = MIME_FORMAT[mimeOf(file.mimetype)];
  const byExt = EXT_FORMAT[extensionOf(file.originalname)];
  if (!byMime || !byExt || byMime !== byExt) return null;
  if (!contentMatches(byMime, file.buffer)) return null;
  return byMime;
}

/** Sniff stored bytes back to a Content-Type for the public serving route. */
export function contentTypeForBytes(buf: Buffer): string {
  if (hasPngMagic(buf)) return 'image/png';
  if (hasJpegMagic(buf)) return 'image/jpeg';
  if (looksLikeSvg(buf)) return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * Strip every active-content vector out of an uploaded SVG before it is stored.
 *
 * SVGs are HTML-adjacent documents: a malicious one can carry `<script>`,
 * inline `on*` handlers, `<foreignObject>` (which can host arbitrary HTML),
 * `javascript:`/`data:` URIs, external `href`/`xlink:href` references, and
 * DOCTYPE/ENTITY declarations (XXE / entity expansion). We remove all of them
 * and keep only same-document fragment references (`#id`). Serving headers
 * (CSP sandbox, nosniff) are a second layer; this is the first.
 */
export function sanitizeSvg(input: Buffer): Buffer {
  let svg = input.toString('utf8');

  // External DTDs / entity definitions — XXE and billion-laughs vectors.
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');

  // <script>…</script> and self-closing <script/>.
  svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, '');
  svg = svg.replace(/<script\b[^>]*\/?>/gi, '');

  // <foreignObject>…</foreignObject> can embed arbitrary (executable) HTML.
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*\/?>/gi, '');

  // Inline event handlers: onload, onclick, onmouseover, …
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/gi, '');

  // href / xlink:href: keep only same-document fragments (#id); drop remote
  // (http(s)), protocol-relative (//), data:, file:, and javascript: targets.
  svg = svg.replace(
    /\s(?:xlink:href|href)\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+)/gi,
    (match, value: string) => {
      const inner = value.replace(/^["']|["']$/g, '').trim();
      return inner.startsWith('#') ? match : '';
    },
  );

  // Any lingering javascript: scheme (e.g. inside style/attribute values).
  svg = svg.replace(/javascript:/gi, '');

  return Buffer.from(svg, 'utf8');
}
