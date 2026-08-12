/**
 * Unit tests for the ImageUploader state-precedence resolver.
 *
 * Pins the ordering the branding uploader rests on (spec Measures M1–M7):
 *   • a stored asset URL renders as a real thumbnail when nothing is picked,
 *   • a newly picked file wins over the stored asset,
 *   • removing the pick falls back to the stored asset, else the empty state,
 *   • the saved path never depends on `File`-only data (it is boolean-gated).
 *
 * DOM-free by design: `resolveImageUploaderView` takes a plain input, so it runs
 * in the `node` jest env with no `File`/jsdom.
 */

import {
  resolveImageUploaderView,
  type ImageUploaderView,
} from './image-uploader-view';

describe('resolveImageUploaderView — saved asset (M1, M2)', () => {
  it('renders the stored URL as a thumbnail when no file is picked', () => {
    const view = resolveImageUploaderView({
      hasFile: false,
      previewUrl: null,
      currentUrl: 'https://cdn.example.com/logo.png',
    });
    expect(view).toEqual<ImageUploaderView>({
      kind: 'saved',
      url: 'https://cdn.example.com/logo.png',
    });
  });
});

describe('resolveImageUploaderView — picked file wins (M3)', () => {
  it('prefers the blob preview over the stored asset', () => {
    const view = resolveImageUploaderView({
      hasFile: true,
      previewUrl: 'blob:preview',
      currentUrl: 'https://cdn.example.com/logo.png',
    });
    expect(view).toEqual<ImageUploaderView>({ kind: 'file', previewUrl: 'blob:preview' });
  });

  it('falls back to the saved asset until the blob URL has resolved', () => {
    // A file is held but its object-URL has not been derived yet (one frame).
    const view = resolveImageUploaderView({
      hasFile: true,
      previewUrl: null,
      currentUrl: 'https://cdn.example.com/logo.png',
    });
    expect(view.kind).toBe('saved');
  });
});

describe('resolveImageUploaderView — empty state (M4)', () => {
  it('is empty when nothing is stored and nothing is picked', () => {
    expect(resolveImageUploaderView({ hasFile: false, previewUrl: null })).toEqual<ImageUploaderView>(
      { kind: 'empty' },
    );
  });

  it('treats null and undefined currentUrl the same as absent', () => {
    expect(
      resolveImageUploaderView({ hasFile: false, previewUrl: null, currentUrl: null }).kind,
    ).toBe('empty');
    expect(
      resolveImageUploaderView({ hasFile: false, previewUrl: null, currentUrl: undefined }).kind,
    ).toBe('empty');
  });

  it('ignores an empty-string currentUrl (no thumbnail from a blank URL)', () => {
    expect(
      resolveImageUploaderView({ hasFile: false, previewUrl: null, currentUrl: '' }).kind,
    ).toBe('empty');
  });
});

describe('resolveImageUploaderView — remove falls back (M5)', () => {
  it('returns to the saved asset after the pick is cleared', () => {
    const url = 'https://cdn.example.com/logo.png';
    // Before removal: a file is held → file view.
    expect(resolveImageUploaderView({ hasFile: true, previewUrl: 'blob:x', currentUrl: url }).kind).toBe(
      'file',
    );
    // After removal (hasFile flips to false): back to the saved thumbnail.
    expect(resolveImageUploaderView({ hasFile: false, previewUrl: null, currentUrl: url })).toEqual<ImageUploaderView>(
      { kind: 'saved', url },
    );
  });

  it('returns to empty after the pick is cleared and nothing is stored', () => {
    expect(resolveImageUploaderView({ hasFile: false, previewUrl: null }).kind).toBe('empty');
  });
});

describe('resolveImageUploaderView — saved path is File-independent (M7)', () => {
  it('resolves the saved view with no file present at all', () => {
    const view = resolveImageUploaderView({
      hasFile: false,
      previewUrl: null,
      currentUrl: 'https://cdn.example.com/favicon.png',
    });
    // The saved branch carries only the URL — no name/size fields to depend on.
    expect(view).toEqual<ImageUploaderView>({
      kind: 'saved',
      url: 'https://cdn.example.com/favicon.png',
    });
  });
});
