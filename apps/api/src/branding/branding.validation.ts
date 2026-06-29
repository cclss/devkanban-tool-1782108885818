/**
 * Server-owned validation rules for the sender branding write paths.
 *
 * These are *implementation/domain* constants (size caps, accepted formats,
 * forgery-detection helpers), not design tokens — changing them does not change
 * how anything looks, only what the API accepts. The closed brand-font catalog
 * and plan entitlements live elsewhere (`branding.constants.ts`,
 * `common/entitlements.ts`); this module owns logo + color validation.
 */

/** Accepted hex color: `#RGB` or `#RRGGBB` (case-insensitive). */
export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Whether a value is a syntactically valid brand color (hex string). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/** Max accepted logo upload size: 2MB. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Recommended longest-edge for stored raster logos (px). Larger raster uploads
 * are downscaled (aspect-preserving, never upscaled) before storage so the
 * signer screen serves a sensibly sized image. SVGs are vector and stored as-is.
 */
export const RECOMMENDED_LOGO_MAX_DIM = 512;

/** The image formats the branding logo upload accepts. */
export type LogoType = 'png' | 'jpeg' | 'svg';

/** File extension stored for each accepted type. */
export const LOGO_TYPE_EXTENSION: Readonly<Record<LogoType, string>> = {
  png: 'png',
  jpeg: 'jpg',
  svg: 'svg',
};

/** Map a (trusted) detected type to the wire MIME used when serving. */
export const LOGO_TYPE_CONTENT_TYPE: Readonly<Record<LogoType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

/** Lowercased file extension (without the dot), or '' when absent. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Map a filename extension to a logo type, or null when not an accepted ext. */
export function logoTypeFromExtension(filename: string): LogoType | null {
  switch (extensionOf(filename)) {
    case 'png':
      return 'png';
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'svg':
      return 'svg';
    default:
      return null;
  }
}

/** Map a declared MIME to a logo type, or null when unknown/unrecognized. */
export function logoTypeFromMime(mime: string | undefined): LogoType | null {
  switch ((mime ?? '').toLowerCase().split(';')[0].trim()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/svg+xml':
    case 'image/svg':
      return 'svg';
    default:
      return null;
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Sniff the *real* type from the leading bytes — never trusts the client's
 * extension or MIME. Returns null when the content matches none of the accepted
 * formats. This is the anti-spoofing core: a renamed `.png`, a fake MIME, or an
 * arbitrary binary all resolve by content, not by claim.
 */
export function detectLogoType(buffer: Buffer): LogoType | null {
  if (buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'png';
  }
  if (buffer.length >= JPEG_MAGIC.length && buffer.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'jpeg';
  }
  if (looksLikeSvg(buffer)) {
    return 'svg';
  }
  return null;
}

/**
 * SVG is text, so there is no fixed magic number — sniff the head for an `<svg`
 * root (optionally preceded by an XML prolog / comments / whitespace). Rejects
 * SVGs carrying inline `<script>` as defense-in-depth (the bytes are stored
 * verbatim once accepted, so a scripted SVG served as `image/svg+xml` is the one
 * raster-free XSS vector worth refusing up front).
 */
export function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!/^<(\?xml|!--|svg)/i.test(head)) return false;
  if (!/<svg[\s>]/i.test(head)) return false;
  if (/<script[\s>]/i.test(buffer.toString('utf8'))) return false;
  return true;
}

/**
 * Decide the trusted logo type for an upload, defeating extension/MIME forgery.
 *
 * Rules (all must hold):
 *  - content magic-bytes resolve to an accepted type (else: not an image),
 *  - the filename extension, when present, agrees with the detected type,
 *  - the declared MIME, when recognized, agrees with the detected type.
 *
 * @returns the trusted {@link LogoType}, or null when anything is inconsistent
 *   or unrecognized (caller maps null → "JPG/PNG/SVG만" rejection).
 */
export function resolveLogoType(file: {
  originalname?: string;
  mimetype?: string;
  buffer: Buffer;
}): LogoType | null {
  const detected = detectLogoType(file.buffer);
  if (!detected) return null;

  const byExt = file.originalname ? logoTypeFromExtension(file.originalname) : null;
  if (byExt !== null && byExt !== detected) return null;

  const byMime = logoTypeFromMime(file.mimetype);
  if (byMime !== null && byMime !== detected) return null;

  return detected;
}
