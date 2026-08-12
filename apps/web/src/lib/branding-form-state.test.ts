/**
 * Unit tests for the BrandingForm save-cycle state logic.
 *
 * Pins the before → after save transition the form rests on:
 *   • pre-save: a newly picked file OR a stored-asset URL change OR a color edit
 *     makes the form dirty, and the save gate additionally requires a valid hex
 *     color and no in-flight save,
 *   • post-save: the color is retained as the new baseline while the picked files
 *     are cleared from both baseline and on-screen values — which is what swaps
 *     each uploader's preview from the local blob back to the stored `?v=` URL.
 *
 * DOM-free by design: the helpers take plain data, so they run in the `node` jest
 * env with no jsdom and no real `File`. A lightweight stand-in exercises the
 * reference-equality dirty check without constructing a browser `File`.
 */

import {
  EMPTY_BRANDING_VALUES,
  applySavedBranding,
  canSaveBranding,
  isBrandingDirty,
  isBrandingValid,
  type BrandingValues,
} from './branding-form-state';

/** A stand-in for a picked `File`; only its object identity matters here. */
type StubFile = { name: string };
const fileA: StubFile = { name: 'logo.png' };
const fileB: StubFile = { name: 'favicon.png' };

const HEX = '#2b6cb0';
const OTHER_HEX = '#1a202c';

function values(patch: Partial<BrandingValues<StubFile>> = {}): BrandingValues<StubFile> {
  return { logo: null, favicon: null, color: HEX, ...patch };
}

describe('EMPTY_BRANDING_VALUES', () => {
  it('is the clean starting state (no files, no color)', () => {
    expect(EMPTY_BRANDING_VALUES).toEqual({ logo: null, favicon: null, color: '' });
  });
});

describe('isBrandingDirty — before save', () => {
  const baseline = values();

  it('is clean when values match the baseline', () => {
    expect(isBrandingDirty(values(), baseline)).toBe(false);
  });

  it('is dirty when a new logo file is picked', () => {
    expect(isBrandingDirty(values({ logo: fileA }), baseline)).toBe(true);
  });

  it('is dirty when a new favicon file is picked', () => {
    expect(isBrandingDirty(values({ favicon: fileB }), baseline)).toBe(true);
  });

  it('is dirty when the color changes', () => {
    expect(isBrandingDirty(values({ color: OTHER_HEX }), baseline)).toBe(true);
  });

  it('compares files by reference, not by name', () => {
    // Same held file object → clean; a different object with the same name → dirty.
    const withFile = values({ logo: fileA });
    expect(isBrandingDirty(withFile, withFile)).toBe(false);
    expect(isBrandingDirty(values({ logo: { name: 'logo.png' } }), withFile)).toBe(true);
  });
});

describe('isBrandingValid — color hex gate', () => {
  it('is valid for a well-formed hex color', () => {
    expect(isBrandingValid(values({ color: HEX }))).toBe(true);
  });

  it('is invalid for a malformed or empty color', () => {
    expect(isBrandingValid(values({ color: 'nope' }))).toBe(false);
    expect(isBrandingValid(values({ color: '' }))).toBe(false);
  });

  it('does not depend on files (a held file with a bad color is still invalid)', () => {
    expect(isBrandingValid(values({ logo: fileA, color: 'bad' }))).toBe(false);
  });
});

describe('canSaveBranding — the save gate', () => {
  const baseline = values();

  it('is enabled for a valid, dirty change that is not saving', () => {
    expect(canSaveBranding(values({ logo: fileA }), baseline, false)).toBe(true);
  });

  it('is disabled when nothing changed', () => {
    expect(canSaveBranding(values(), baseline, false)).toBe(false);
  });

  it('is disabled when the color is invalid, even if dirty', () => {
    expect(canSaveBranding(values({ logo: fileA, color: 'bad' }), baseline, false)).toBe(false);
  });

  it('is disabled while a save is in flight', () => {
    expect(canSaveBranding(values({ logo: fileA }), baseline, true)).toBe(false);
  });
});

describe('applySavedBranding — after save', () => {
  it('keeps the persisted color as the new baseline and clears picked files', () => {
    const persisted = values({ logo: fileA, favicon: fileB, color: OTHER_HEX });
    const next = applySavedBranding(persisted);

    expect(next.baseline).toEqual({ logo: null, favicon: null, color: OTHER_HEX });
    expect(next.values).toEqual({ logo: null, favicon: null, color: OTHER_HEX });
  });

  it('returns clean: the post-save values are not dirty against the new baseline', () => {
    const next = applySavedBranding(values({ logo: fileA, color: OTHER_HEX }));
    expect(isBrandingDirty(next.values, next.baseline)).toBe(false);
    expect(canSaveBranding(next.values, next.baseline, false)).toBe(false);
  });

  it('does not mutate the input values', () => {
    const persisted = values({ logo: fileA, favicon: fileB, color: OTHER_HEX });
    applySavedBranding(persisted);
    expect(persisted.logo).toBe(fileA);
    expect(persisted.favicon).toBe(fileB);
  });
});

describe('full before → after save transition', () => {
  it('goes from a dirty, saveable pick to a clean saved state on the stored URL', () => {
    // Before: baseline is a plain seeded color, user picks a logo + edits color.
    const baseline = values({ color: HEX });
    const staged = values({ logo: fileA, color: OTHER_HEX });
    expect(isBrandingDirty(staged, baseline)).toBe(true);
    expect(canSaveBranding(staged, baseline, false)).toBe(true);

    // After: the picked file is cleared (preview swaps to the saved `?v=` asset),
    // the color is retained, and the form settles clean.
    const next = applySavedBranding(staged);
    expect(next.values.logo).toBeNull();
    expect(next.values.color).toBe(OTHER_HEX);
    expect(isBrandingDirty(next.values, next.baseline)).toBe(false);
  });
});
