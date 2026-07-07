/**
 * Server-side branding image validation (로고 · 파비콘).
 *
 * The web client already validates a picked file (`apps/web/src/lib/
 * image-validation.ts`), but that guard is bypassable — so the API re-checks
 * every upload here before persisting bytes. The accepted formats (SVG · PNG)
 * and 1MB ceiling mirror the client constants exactly so both sides agree.
 *
 * Beyond MIME/extension (which a client fully controls), this also sniffs the
 * file's magic bytes — a `.png` claim must actually start with the PNG
 * signature, and an `.svg` claim must actually contain an `<svg` root — so a
 * mislabelled or hostile file can't slip past. This mirrors the document
 * upload's `(byMime || byExt) && byMagic` philosophy.
 *
 * Pure and DOM-free so the rules are unit-testable in isolation.
 */

/** Which branding slot an asset fills. */
export type BrandingAssetKind = 'logo' | 'favicon';

/** Canonical stored MIME types for branding assets. */
export const ACCEPTED_IMAGE_MIME_TYPES = ['image/svg+xml', 'image/png'] as const;

/** Accepted extensions — fallback when a browser reports an empty/odd MIME. */
export const ACCEPTED_IMAGE_EXTENSIONS = ['.svg', '.png'] as const;

/** Maximum branding image size in bytes (1MB) — mirrors the client guard. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** The minimal uploaded-file shape the validator needs (a Multer file fits). */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Why a branding image was rejected — maps 1:1 to a user-facing message. */
export type BrandingImageError = 'emptyFile' | 'fileTooLarge' | 'invalidType';

export type BrandingImageValidation =
  | { ok: true; contentType: (typeof ACCEPTED_IMAGE_MIME_TYPES)[number] }
  | { ok: false; error: BrandingImageError };

// PNG signature: 89 50 4E 47 0D 0A 1A 0A.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function hasExtension(name: string, ext: string): boolean {
  return name.toLowerCase().endsWith(ext);
}

function looksLikePng(buffer: Buffer): boolean {
  return buffer.length >= PNG_MAGIC.length && buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

function looksLikeSvg(buffer: Buffer): boolean {
  // SVG is XML text; it may open with a BOM, an `<?xml?>` prolog, comments, or
  // a doctype before the root, so sniff a leading window for an `<svg` token
  // rather than requiring it at byte 0. (A leading BOM doesn't matter here — we
  // scan for `<svg` anywhere in the window, not at offset 0.)
  const head = buffer.subarray(0, 1024).toString('utf8').toLowerCase();
  return head.includes('<svg');
}

/**
 * Resolve the canonical Content-Type for an uploaded image, or `null` when the
 * claimed format and the actual bytes don't agree. A claim (by MIME or
 * extension) is necessary but not sufficient — the bytes must match too.
 */
function detectContentType(file: UploadedImage): (typeof ACCEPTED_IMAGE_MIME_TYPES)[number] | null {
  const claimsPng = file.mimetype === 'image/png' || hasExtension(file.originalname, '.png');
  const claimsSvg = file.mimetype === 'image/svg+xml' || hasExtension(file.originalname, '.svg');

  if (claimsPng && looksLikePng(file.buffer)) return 'image/png';
  if (claimsSvg && looksLikeSvg(file.buffer)) return 'image/svg+xml';
  return null;
}

/**
 * Validate a branding image against the format/size constraints.
 *
 * Order is deliberate — empty → too large → format — so the most fundamental
 * problem surfaces first (a 0-byte file reads as "empty", not "wrong format").
 * Returns the canonical Content-Type to store the bytes with on success.
 */
export function validateBrandingImage(file: UploadedImage | undefined): BrandingImageValidation {
  if (!file || !file.buffer || file.size === 0 || file.buffer.length === 0) {
    return { ok: false, error: 'emptyFile' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'fileTooLarge' };
  }
  const contentType = detectContentType(file);
  if (!contentType) {
    return { ok: false, error: 'invalidType' };
  }
  return { ok: true, contentType };
}

/** Parse a serving-route `:kind` param into a known asset kind, or `null`. */
export function parseAssetKind(raw: string): BrandingAssetKind | null {
  return raw === 'logo' || raw === 'favicon' ? raw : null;
}
