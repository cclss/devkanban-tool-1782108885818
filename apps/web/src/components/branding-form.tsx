'use client';

/**
 * BrandingForm — the 설정 → 브랜딩 form. It assembles the existing branding
 * controls into one page-level form: two ImageUploaders (로고 · 파비콘) reusing
 * the same control, and the BrandColorPicker for the 대표 색상. It owns each
 * field's local value, aggregates validity, and provides a save/cancel action
 * bar (save enabled only when there's a valid change to keep).
 *
 * Persistence: there is no backend brand-update path yet (no update endpoint,
 * no image storage pipeline), so saving holds the values locally as the new
 * baseline and surfaces a calm status line — service-wide reflection is a later
 * feature. Cancel reverts the fields to the last saved baseline.
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
import { isValidHex } from '@/lib/branding';
import { BRANDING_FORM_COPY } from '@/lib/settings-copy';

interface BrandingValues {
  logo: File | null;
  favicon: File | null;
  color: string;
}

const EMPTY: BrandingValues = { logo: null, favicon: null, color: '' };

export function BrandingForm() {
  // `baseline` is the last-saved state; `values` is what's on screen. Dirtiness
  // and cancel both compare against the baseline.
  const [baseline, setBaseline] = React.useState<BrandingValues>(EMPTY);
  const [values, setValues] = React.useState<BrandingValues>(EMPTY);
  const [saved, setSaved] = React.useState(false);

  // Seed 대표 색상 from the brand color currently in force (the live
  // `--brand-primary` token) instead of a hardcoded literal, so the form opens
  // on the real current color and the swatch/preview aren't empty.
  React.useEffect(() => {
    const current = getComputedStyle(document.documentElement)
      .getPropertyValue('--brand-primary')
      .trim();
    if (isValidHex(current)) {
      setBaseline((b) => ({ ...b, color: current }));
      setValues((v) => ({ ...v, color: current }));
    }
  }, []);

  const isDirty =
    values.logo !== baseline.logo ||
    values.favicon !== baseline.favicon ||
    values.color !== baseline.color;
  // Form-level validity: images are pre-validated by the uploader (a held file is
  // valid by construction), so the color's hex validity is the aggregate gate.
  const isValid = isValidHex(values.color);
  const canSave = isDirty && isValid;

  const update = React.useCallback((patch: Partial<BrandingValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setSaved(false);
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    // No backend path yet — keep the values locally as the new baseline and let
    // the status line explain that service-wide reflection is on the way.
    setBaseline(values);
    setSaved(true);
  };

  const handleCancel = () => {
    setValues(baseline);
    setSaved(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-lg" noValidate>
      <div className="flex flex-col gap-lg">
        <ImageUploader
          id="branding-logo"
          label={BRANDING_FORM_COPY.logoLabel}
          value={values.logo}
          onChange={(file) => update({ logo: file })}
        />
        <ImageUploader
          id="branding-favicon"
          label={BRANDING_FORM_COPY.faviconLabel}
          value={values.favicon}
          onChange={(file) => update({ favicon: file })}
        />
        <BrandColorPicker
          id="branding-color"
          value={values.color}
          onChange={(hex) => update({ color: hex })}
        />
      </div>

      {saved ? (
        <p
          role="status"
          className="rounded-md bg-primary-subtle px-md py-sm text-sm font-semibold text-primary"
        >
          {BRANDING_FORM_COPY.savedNotice}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-sm border-t border-border pt-md">
        <Button type="button" variant="ghost" onClick={handleCancel} disabled={!isDirty}>
          {BRANDING_FORM_COPY.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!canSave}>
          {BRANDING_FORM_COPY.save}
        </Button>
      </div>
    </form>
  );
}
