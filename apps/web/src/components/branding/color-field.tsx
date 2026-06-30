'use client';

/**
 * ColorField — brand color input with a native color picker and a hex code
 * field kept in two-way sync, plus a live swatch and inline validation.
 *
 * The styled swatch IS the native `<input type="color">` (the OS picker opens on
 * click/Enter); a sibling text input accepts a typed `#rrggbb`. Editing either
 * one updates the other through the single `value` the parent owns. Visual
 * values come from tokens; the swatch fill is the user's chosen color (runtime
 * content, like an uploaded logo — not a design token).
 */

import * as React from 'react';
import { Field, Input, cn } from '@repo/ui';
import { BRANDING_COPY, expandHex, isValidHex } from '@/lib/branding-settings';

/** Native color input needs a concrete `#rrggbb`; use the default brand blue. */
const PICKER_FALLBACK = '#1c64f2';

export function ColorField({
  value,
  onChange,
  onReset,
  disabled = false,
  showError = false,
  id = 'brand-color',
}: {
  /** The current hex text (source of truth, owned by the parent). */
  value: string;
  onChange: (next: string) => void;
  /** Clear back to the default tokens. */
  onReset: () => void;
  disabled?: boolean;
  /** Surface the inline validation message (e.g. after a save attempt). */
  showError?: boolean;
  id?: string;
}) {
  const trimmed = value.trim();
  const valid = trimmed === '' || isValidHex(trimmed);
  const expanded = expandHex(trimmed);
  const error = showError && !valid ? BRANDING_COPY.color.invalid : undefined;
  const hasColor = trimmed !== '';

  return (
    <Field
      label={BRANDING_COPY.color.label}
      htmlFor={id}
      hint={BRANDING_COPY.color.hint}
      error={error}
    >
      <div className="flex items-center gap-sm">
        {/* Swatch + native picker. The input sits invisibly over the swatch so
            the OS color dialog opens on click while staying keyboard-focusable. */}
        <span
          className={cn(
            'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border',
            'transition-[border-color,box-shadow] duration-fast ease-standard',
            'focus-within:ring-4 focus-within:ring-focus',
            valid ? 'border-border' : 'border-danger',
            disabled && 'opacity-60',
          )}
          style={expanded ? { backgroundColor: expanded } : undefined}
        >
          {/* Checkerboard hint when there's no (valid) color yet. */}
          {!expanded ? (
            <span aria-hidden="true" className="text-xs font-semibold text-foreground-subtle">
              #
            </span>
          ) : null}
          <input
            type="color"
            aria-label={BRANDING_COPY.color.pickerLabel}
            value={expanded ?? PICKER_FALLBACK}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </span>

        <Input
          id={id}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={7}
          placeholder={BRANDING_COPY.color.placeholder}
          aria-label={BRANDING_COPY.color.inputLabel}
          value={value}
          disabled={disabled}
          invalid={Boolean(error)}
          aria-describedby={error ? `${id}-message` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="font-[inherit] tracking-wide"
        />

        {hasColor && !disabled ? (
          <button
            type="button"
            onClick={onReset}
            className={cn(
              'shrink-0 rounded-md px-sm py-xs text-sm font-semibold text-foreground-subtle',
              'transition-colors duration-fast ease-standard',
              'hover:bg-grey-100 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
            )}
          >
            {BRANDING_COPY.color.reset}
          </button>
        ) : null}
      </div>
    </Field>
  );
}
