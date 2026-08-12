/**
 * Pure save-cycle state logic for `BrandingForm`.
 *
 * The 설정 → 브랜딩 form tracks three fields (logo · favicon files + 대표 색상)
 * against a last-saved baseline, and its save button is gated on three derived
 * bits: is the on-screen state dirty, is it valid, and are we mid-save. It also
 * has one non-obvious transition — after a successful save the color is kept but
 * the picked files are cleared, which is what makes the uploaders' preview swap
 * from the local blob back to the stored `?v=` versioned asset URL.
 *
 * That logic is plain data-in/data-out, so it lives here — DOM-free, no React —
 * exactly like `image-uploader-view.ts`. It runs in the `node` jest env (no
 * jsdom, no `File` construction) and both the component and its tests read the
 * gating/transition rules from this single source.
 *
 * The file slot is generic (default `File`) so the component keeps its real
 * `File | null` fields while tests can substitute a lightweight stand-in and
 * still exercise the reference-equality dirty check.
 */

import { isValidHex } from './branding';

export interface BrandingValues<TFile = File> {
  /** A newly picked logo file, or `null` when none is staged. */
  logo: TFile | null;
  /** A newly picked favicon file, or `null` when none is staged. */
  favicon: TFile | null;
  /** The 대표 색상 as a hex string (`''` before it is seeded). */
  color: string;
}

/** The clean starting state: no picked files, no color yet. */
export const EMPTY_BRANDING_VALUES: BrandingValues = {
  logo: null,
  favicon: null,
  color: '',
};

/**
 * Has the on-screen state moved off the last-saved baseline? Files are compared
 * by reference (a fresh pick is a new `File`), the color by value.
 */
export function isBrandingDirty<TFile>(
  values: BrandingValues<TFile>,
  baseline: BrandingValues<TFile>,
): boolean {
  return (
    values.logo !== baseline.logo ||
    values.favicon !== baseline.favicon ||
    values.color !== baseline.color
  );
}

/**
 * Form-level validity. Images are pre-validated by the uploader (a held file is
 * valid by construction), so the color's hex validity is the aggregate gate.
 */
export function isBrandingValid<TFile>(values: BrandingValues<TFile>): boolean {
  return isValidHex(values.color);
}

/**
 * Whether the save action should be enabled: a valid change exists to keep and
 * no save is already in flight.
 */
export function canSaveBranding<TFile>(
  values: BrandingValues<TFile>,
  baseline: BrandingValues<TFile>,
  saving: boolean,
): boolean {
  return isBrandingDirty(values, baseline) && isBrandingValid(values) && !saving;
}

/** The `{ baseline, values }` pair the form should hold after a successful save. */
export interface SavedBrandingTransition<TFile> {
  baseline: BrandingValues<TFile>;
  values: BrandingValues<TFile>;
}

/**
 * Compute the post-save state from the values that were just persisted. The
 * color becomes the new baseline; the picked files are cleared from both baseline
 * and on-screen values, so the form returns clean and each uploader's preview
 * falls back to the freshly `?v=` versioned stored asset URL instead of the local
 * blob.
 */
export function applySavedBranding<TFile>(
  persisted: BrandingValues<TFile>,
): SavedBrandingTransition<TFile> {
  return {
    baseline: { logo: null, favicon: null, color: persisted.color },
    values: { ...persisted, logo: null, favicon: null },
  };
}
