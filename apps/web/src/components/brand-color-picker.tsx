'use client';

/**
 * BrandColorPicker — the 대표 색상 control for the branding form.
 *
 * A controlled, presentation-only component: the parent owns the committed
 * brand color (`value` / `onChange`) and this renders a swatch (native color
 * picker) + a HEX text field + a live preview. There is no save here — the
 * actual persistence and service-wide application land with the branding form
 * and its wiring (later grains).
 *
 * The accepted color shape and the preview re-skin both defer to `lib/branding`:
 * `isValidHex` is the single validity gate (`#rgb` / `#rrggbb`), `brandStyle`
 * expands one color into the `--brand-*` hook the preview samples inherit from,
 * and `expandHex` adapts a color for the native `<input type="color">`. No HEX
 * rule or token mapping is redefined here. All chrome (borders, spacing, text,
 * primary samples) reuses existing `globals.css` tokens; the only literal color
 * is the user's own picked value shown in the swatch — that's data, not a token.
 */

import * as React from 'react';
import { Button, Field, Input, cn } from '@repo/ui';
import { brandStyle, expandHex, isValidHex } from '@/lib/branding';
import { useTranslation } from '@/components/locale-provider';

export interface BrandColorPickerProps {
  /** Ties the field label to the HEX input. Must be unique on the page. */
  id: string;
  /** The committed brand color, a valid `#rgb` / `#rrggbb` hex. */
  value: string;
  /** Called with a valid hex when the swatch or a valid HEX entry commits. */
  onChange: (hex: string) => void;
  /** Field label. Defaults to the settings copy (`대표 색상`). */
  label?: React.ReactNode;
  /** Constraint hint under the field. Defaults to the settings copy. */
  hint?: React.ReactNode;
  className?: string;
}

export function BrandColorPicker({
  id,
  value,
  onChange,
  label,
  hint,
  className,
}: BrandColorPickerProps) {
  const t = useTranslation();
  const swatchId = `${id}-swatch`;
  // Local draft mirrors the text field so the user can type an in-progress
  // (temporarily invalid) value without the committed color jumping. It re-syncs
  // whenever a new committed color arrives (from the swatch or from the parent).
  const [draft, setDraft] = React.useState(value);
  // Track only *whether* the current draft is invalid; the message itself is
  // resolved from the catalog at render so it re-localizes with the active locale.
  const [invalid, setInvalid] = React.useState(false);
  const error = invalid ? t('branding.colorInvalidHex') : null;

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  // The color currently in force: the draft if it's a valid hex, else the last
  // committed value. Swatch, native input, and preview all read from this.
  const active = isValidHex(draft) ? draft.trim() : value;
  const swatchValue = isValidHex(active) ? expandHex(active) : '#000000';

  const handleHexInput = React.useCallback(
    (raw: string) => {
      setDraft(raw);
      if (isValidHex(raw)) {
        setInvalid(false);
        onChange(raw.trim());
      } else if (raw.trim() === '') {
        // Empty is "not yet decided", not an error — the committed color stays.
        setInvalid(false);
      } else {
        setInvalid(true);
      }
    },
    [onChange],
  );

  const handleSwatch = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      // The native color input only ever yields a valid `#rrggbb`.
      setInvalid(false);
      onChange(event.target.value);
    },
    [onChange],
  );

  return (
    <Field
      label={label ?? t('branding.colorLabel')}
      htmlFor={id}
      hint={hint ?? t('branding.colorHint')}
      error={error}
      className={className}
    >
      <div className="flex items-stretch gap-sm">
        {/* Swatch: a color chip whose click/keyboard opens the OS color picker.
            The native input is overlaid transparently so the chip stays visible;
            focus surfaces via the label's focus-within ring. */}
        <label
          htmlFor={swatchId}
          className={cn(
            'relative flex h-12 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border',
            'transition-shadow duration-fast ease-standard',
            'focus-within:border-primary focus-within:ring-4 focus-within:ring-focus',
          )}
          style={{ backgroundColor: active }}
        >
          <span className="sr-only">{t('branding.colorSwatchLabel')}</span>
          <input
            id={swatchId}
            type="color"
            value={swatchValue}
            onChange={handleSwatch}
            aria-label={t('branding.colorSwatchLabel')}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <Input
          id={id}
          value={draft}
          onChange={(e) => handleHexInput(e.target.value)}
          invalid={!!error}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="text"
          placeholder="#163AF2"
          className="flex-1 font-mono uppercase"
        />
      </div>

      {/* Live preview: a wrapper carrying the `--brand-*` hook, so the sample
          primary elements re-skin to `active` exactly as they will service-wide.
          Purely illustrative, so it's hidden from assistive tech — the field's
          own value already conveys the chosen color. */}
      <div className="mt-xs flex flex-col gap-xs">
        <span className="text-xs font-semibold text-foreground-muted">
          {t('branding.colorPreviewLabel')}
        </span>
        <div
          aria-hidden="true"
          style={brandStyle(active)}
          className="flex flex-wrap items-center gap-md rounded-lg border border-border bg-surface p-md"
        >
          <Button type="button" variant="primary" size="sm" tabIndex={-1}>
            {t('branding.colorPreviewButton')}
          </Button>
          <span className="text-sm font-semibold text-primary underline underline-offset-2">
            {t('branding.colorPreviewLink')}
          </span>
          <span className="ml-auto inline-flex items-center rounded-full bg-primary-subtle px-md py-2xs text-xs font-semibold uppercase text-primary">
            {active}
          </span>
        </div>
      </div>
    </Field>
  );
}
