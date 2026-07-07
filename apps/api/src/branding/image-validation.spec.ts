import {
  MAX_IMAGE_BYTES,
  parseAssetKind,
  validateBrandingImage,
  type UploadedImage,
} from './image-validation';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFile(overrides: Partial<UploadedImage> = {}): UploadedImage {
  const buffer = Buffer.concat([PNG_HEADER, Buffer.from('rest-of-png')]);
  return { originalname: 'logo.png', mimetype: 'image/png', size: buffer.length, buffer, ...overrides };
}

function svgFile(overrides: Partial<UploadedImage> = {}): UploadedImage {
  const buffer = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return { originalname: 'logo.svg', mimetype: 'image/svg+xml', size: buffer.length, buffer, ...overrides };
}

describe('validateBrandingImage', () => {
  it('accepts a real PNG (magic bytes match) → image/png', () => {
    expect(validateBrandingImage(pngFile())).toEqual({ ok: true, contentType: 'image/png' });
  });

  it('accepts a real SVG (contains <svg root) → image/svg+xml', () => {
    expect(validateBrandingImage(svgFile())).toEqual({ ok: true, contentType: 'image/svg+xml' });
  });

  it('accepts an SVG with empty MIME by extension (browser leniency)', () => {
    expect(validateBrandingImage(svgFile({ mimetype: '' }))).toEqual({
      ok: true,
      contentType: 'image/svg+xml',
    });
  });

  it('accepts a file exactly at the 1MB boundary', () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_IMAGE_BYTES - PNG_HEADER.length)]);
    const result = validateBrandingImage(pngFile({ buffer, size: MAX_IMAGE_BYTES }));
    expect(result).toEqual({ ok: true, contentType: 'image/png' });
  });

  it('rejects a JPEG (unaccepted format) → invalidType', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(
      validateBrandingImage({ originalname: 'photo.jpg', mimetype: 'image/jpeg', size: buffer.length, buffer }),
    ).toEqual({ ok: false, error: 'invalidType' });
  });

  it('rejects a .png claim whose bytes are not a real PNG → invalidType', () => {
    const buffer = Buffer.from('not actually a png');
    expect(validateBrandingImage(pngFile({ buffer, size: buffer.length }))).toEqual({
      ok: false,
      error: 'invalidType',
    });
  });

  it('rejects a .svg claim with no <svg root → invalidType', () => {
    const buffer = Buffer.from('<html><body>nope</body></html>');
    expect(validateBrandingImage(svgFile({ buffer, size: buffer.length }))).toEqual({
      ok: false,
      error: 'invalidType',
    });
  });

  it('rejects an empty (0-byte) file → emptyFile (before format)', () => {
    expect(validateBrandingImage(pngFile({ buffer: Buffer.alloc(0), size: 0 }))).toEqual({
      ok: false,
      error: 'emptyFile',
    });
  });

  it('rejects a missing file → emptyFile', () => {
    expect(validateBrandingImage(undefined)).toEqual({ ok: false, error: 'emptyFile' });
  });

  it('rejects a file over 1MB → fileTooLarge (before format)', () => {
    const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(validateBrandingImage(pngFile({ buffer, size: MAX_IMAGE_BYTES + 1 }))).toEqual({
      ok: false,
      error: 'fileTooLarge',
    });
  });
});

describe('parseAssetKind', () => {
  it('accepts logo and favicon', () => {
    expect(parseAssetKind('logo')).toBe('logo');
    expect(parseAssetKind('favicon')).toBe('favicon');
  });

  it('rejects anything else', () => {
    expect(parseAssetKind('banner')).toBeNull();
    expect(parseAssetKind('')).toBeNull();
    expect(parseAssetKind('LOGO')).toBeNull();
  });
});
