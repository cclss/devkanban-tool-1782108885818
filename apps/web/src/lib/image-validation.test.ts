/**
 * Branding image-validation unit tests.
 *
 * Pins the rules the image uploader (로고 · 파비콘) rests on:
 *   • accepted formats (SVG / PNG) by MIME and by extension fallback,
 *   • rejected formats,
 *   • empty vs oversize ordering and the 1MB boundary,
 *   • the exact Korean guard copy (single source, base voice).
 *
 * Runs in the `node` jest environment: `validateImageFile` takes a plain
 * `{ name, type, size }`, so no DOM `File` is needed.
 */

import {
  validateImageFile,
  formatImageSize,
  MAX_IMAGE_BYTES,
  IMAGE_VALIDATION_COPY,
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_IMAGE_EXTENSIONS,
  type ValidatedFile,
} from './image-validation';

/** Build a file descriptor with sensible defaults for the field under test. */
function file(overrides: Partial<ValidatedFile> = {}): ValidatedFile {
  return { name: 'logo.png', type: 'image/png', size: 10 * 1024, ...overrides };
}

describe('validateImageFile — accepted', () => {
  it('accepts a PNG by MIME type', () => {
    expect(validateImageFile(file({ name: 'logo.png', type: 'image/png' }))).toBeNull();
  });

  it('accepts an SVG by MIME type', () => {
    expect(validateImageFile(file({ name: 'logo.svg', type: 'image/svg+xml' }))).toBeNull();
  });

  it('accepts an SVG by extension when the browser reports an empty MIME type', () => {
    expect(validateImageFile(file({ name: 'brand.svg', type: '' }))).toBeNull();
  });

  it('accepts a PNG by extension regardless of case', () => {
    expect(validateImageFile(file({ name: 'LOGO.PNG', type: '' }))).toBeNull();
  });

  it('accepts a file exactly at the 1MB limit', () => {
    expect(validateImageFile(file({ size: MAX_IMAGE_BYTES }))).toBeNull();
  });
});

describe('validateImageFile — rejected', () => {
  it('rejects a JPEG as the wrong format', () => {
    expect(validateImageFile(file({ name: 'photo.jpg', type: 'image/jpeg' }))).toBe(
      IMAGE_VALIDATION_COPY.invalidType,
    );
  });

  it('rejects a PDF (wrong format wins over size checks)', () => {
    expect(
      validateImageFile(file({ name: 'doc.pdf', type: 'application/pdf', size: 0 })),
    ).toBe(IMAGE_VALIDATION_COPY.invalidType);
  });

  it('rejects an empty but correctly-typed file', () => {
    expect(validateImageFile(file({ size: 0 }))).toBe(IMAGE_VALIDATION_COPY.empty);
  });

  it('rejects a file one byte over the 1MB limit', () => {
    expect(validateImageFile(file({ size: MAX_IMAGE_BYTES + 1 }))).toBe(
      IMAGE_VALIDATION_COPY.tooLarge,
    );
  });

  it('surfaces the format problem before the size problem', () => {
    // An oversize JPEG reads as "wrong format", not "too large".
    expect(
      validateImageFile(file({ name: 'big.jpg', type: 'image/jpeg', size: MAX_IMAGE_BYTES * 5 })),
    ).toBe(IMAGE_VALIDATION_COPY.invalidType);
  });
});

describe('constants', () => {
  it('caps size at exactly 1MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(1024 * 1024);
  });

  it('accepts only SVG and PNG', () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(['image/svg+xml', 'image/png']);
    expect(ACCEPTED_IMAGE_EXTENSIONS).toEqual(['.svg', '.png']);
  });
});

describe('formatImageSize', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatImageSize(512)).toBe('512 B');
    expect(formatImageSize(240 * 1024)).toBe('240 KB');
    expect(formatImageSize(MAX_IMAGE_BYTES)).toBe('1.0 MB');
  });
});
