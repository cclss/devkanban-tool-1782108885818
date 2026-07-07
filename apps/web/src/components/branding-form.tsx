'use client';

/**
 * BrandingForm — the 설정 → 브랜딩 form. It assembles the existing branding
 * controls into one page-level form: two ImageUploaders (로고 · 파비콘) reusing
 * the same control, and the BrandColorPicker for the 대표 색상. It owns each
 * field's local value, aggregates validity, and provides a save/cancel action
 * bar (save enabled only when there's a valid change to keep).
 *
 * Persistence (real, this grain): on mount it loads `GET /branding` to seed the
 * current 대표 색상 and whether a logo/favicon is already set. On save it uploads
 * any newly picked logo/favicon (`POST /branding/logo|favicon`), persists the
 * color (`PATCH /branding`), then calls the global runtime's `refresh()` so the
 * header logo, browser-tab favicon, and brand color update for every end user
 * immediately — no reload. Upload/save failures surface inline as the server's
 * `ApiError` copy. Cancel reverts the fields to the last saved baseline.
 *
 * All chrome reuses existing `globals.css` tokens; no new colors, spacing, or
 * radii. The child controls own their own inline validation and only ever
 * surface valid values up here, so the parent's held state stays valid — the
 * one form-level gate is that the 대표 색상 is a valid hex.
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { ImageUploader } from './image-uploader';
import { BrandColorPicker } from './brand-color-picker';
import { useBranding } from './branding-provider';
import { isValidHex } from '@/lib/branding';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { fetchBranding, updateBrandColor, uploadBrandingAsset } from '@/lib/web-branding';
import { BRANDING_FORM_COPY } from '@/lib/settings-copy';

interface BrandingValues {
  logo: File | null;
  favicon: File | null;
  color: string;
}

const EMPTY: BrandingValues = { logo: null, favicon: null, color: '' };

/** Read the brand color currently in force from the live `--brand-primary` token. */
function readBrandPrimary(): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim();
}

export function BrandingForm() {
  // The global runtime's refresh() re-fetches branding and re-applies it across
  // the whole app (header logo · favicon · brand color) the moment we save.
  const { refresh } = useBranding();

  // `baseline` is the last-saved state; `values` is what's on screen. Dirtiness
  // and cancel both compare against the baseline.
  const [baseline, setBaseline] = React.useState<BrandingValues>(EMPTY);
  const [values, setValues] = React.useState<BrandingValues>(EMPTY);
  // Whether a logo/favicon is already persisted — surfaced as an uploader hint so
  // the admin knows a re-upload replaces the current one (the control is
  // file-only, so we don't preview the stored asset here).
  const [hasLogo, setHasLogo] = React.useState(false);
  const [hasFavicon, setHasFavicon] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Seed from the persisted branding: current 대표 색상 + logo/favicon presence.
  // Fall back to the live `--brand-primary` token when the color is unset (or the
  // load fails) so the swatch/preview open on the real current color, not empty.
  React.useEffect(() => {
    let active = true;
    const seedColor = (raw: string | null) => {
      const color = raw && isValidHex(raw) ? raw : readBrandPrimary();
      if (!isValidHex(color)) return;
      setBaseline((b) => ({ ...b, color }));
      setValues((v) => ({ ...v, color }));
    };
    fetchBranding()
      .then((b) => {
        if (!active) return;
        setHasLogo(Boolean(b.logoUrl));
        setHasFavicon(Boolean(b.faviconUrl));
        seedColor(b.brandColor);
      })
      .catch(() => {
        if (active) seedColor(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const isDirty =
    values.logo !== baseline.logo ||
    values.favicon !== baseline.favicon ||
    values.color !== baseline.color;
  // Form-level validity: images are pre-validated by the uploader (a held file is
  // valid by construction), so the color's hex validity is the aggregate gate.
  const isValid = isValidHex(values.color);
  const canSave = isDirty && isValid && !saving;

  const update = React.useCallback((patch: Partial<BrandingValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setSaved(false);
    setError(null);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const token = getToken() ?? undefined;
    try {
      // Persist only what changed: upload newly picked assets, save the color if
      // it moved. The uploader guarantees any held file already passed validation.
      if (values.logo) await uploadBrandingAsset('logo', values.logo, token);
      if (values.favicon) await uploadBrandingAsset('favicon', values.favicon, token);
      if (values.color !== baseline.color) await updateBrandColor(values.color, token);
      // Re-apply across the service immediately — header logo, browser-tab
      // favicon, and brand color update for every end user with no reload.
      await refresh();
      // New baseline: the color is persisted; the picked files are now stored, so
      // clear them (existence is tracked separately) and the form returns clean.
      if (values.logo) setHasLogo(true);
      if (values.favicon) setHasFavicon(true);
      setBaseline({ logo: null, favicon: null, color: values.color });
      setValues((v) => ({ ...v, logo: null, favicon: null }));
      setSaved(true);
    } catch (err) {
      // Surface the server's Toss-tone copy inline; never expose raw errors.
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setValues(baseline);
    setSaved(false);
    setError(null);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-lg" noValidate>
      <div className="flex flex-col gap-lg">
        <ImageUploader
          id="branding-logo"
          label={BRANDING_FORM_COPY.logoLabel}
          hint={hasLogo ? BRANDING_FORM_COPY.logoSetHint : undefined}
          value={values.logo}
          onChange={(file) => update({ logo: file })}
        />
        <ImageUploader
          id="branding-favicon"
          label={BRANDING_FORM_COPY.faviconLabel}
          hint={hasFavicon ? BRANDING_FORM_COPY.faviconSetHint : undefined}
          value={values.favicon}
          onChange={(file) => update({ favicon: file })}
        />
        <BrandColorPicker
          id="branding-color"
          value={values.color}
          onChange={(hex) => update({ color: hex })}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-danger-subtle px-md py-sm text-sm text-danger">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p
          role="status"
          className="rounded-md bg-primary-subtle px-md py-sm text-sm font-semibold text-primary"
        >
          {BRANDING_FORM_COPY.savedNotice}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-sm border-t border-border pt-md">
        <Button type="button" variant="ghost" onClick={handleCancel} disabled={!isDirty || saving}>
          {BRANDING_FORM_COPY.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave} isLoading={saving}>
          {BRANDING_FORM_COPY.save}
        </Button>
      </div>
    </form>
  );
}
