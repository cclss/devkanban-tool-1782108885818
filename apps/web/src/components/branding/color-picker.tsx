'use client';

/**
 * ColorPicker — brand color selection.
 *
 * Three coordinated affordances over one hex value: a native color picker (the
 * swatch button), a hex text input, and a row of preset swatches. A live AA
 * check warns (non-blocking) when the chosen color would be hard to read on the
 * white signer surface. All copy lives in `BRANDING_COPY` (single source).
 */

import * as React from 'react';
import { Field, Input, cn } from '@repo/ui';
import {
  BRANDING_COPY,
  COLOR_PRESETS,
  isHexColor,
  isLowContrastOnWhite,
} from '@/lib/branding';

const C = BRANDING_COPY.color;

/** Native `<input type="color">` needs `#rrggbb`; expand `#rgb` for it. */
function toLongHex(hex: string): string {
  if (!isHexColor(hex)) return '#000000';
  const h = hex.trim();
  if (h.length === 4) {
    return '#' + h.slice(1).split('').map((c) => c + c).join('');
  }
  return h;
}

export function ColorPicker({
  value,
  onChange,
  disabled,
  id = 'brand-color',
}: {
  value: string | null;
  onChange: (hex: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  // Local text mirrors the committed value but lets the user type freely; we
  // only commit when the string is a valid hex color.
  const [text, setText] = React.useState(value ?? '');
  React.useEffect(() => {
    setText(value ?? '');
  }, [value]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    setText(trimmed);
    if (isHexColor(trimmed)) onChange(trimmed);
  };

  const invalid = text.trim().length > 0 && !isHexColor(text);
  const lowContrast = isLowContrastOnWhite(value);
  const swatch = isHexColor(value) ? toLongHex(value) : '#ffffff';

  return (
    <Field
      label={C.label}
      htmlFor={id}
      hint={invalid ? undefined : C.hint}
      error={invalid ? '브랜드 색상은 #RRGGBB 형식의 색상 코드로 입력해 주세요.' : undefined}
    >
      <div className="flex items-center gap-sm">
        {/* Native picker, surfaced as a tappable swatch. */}
        <label
          className={cn(
            'relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border',
            'transition-shadow duration-fast ease-standard',
            'focus-within:ring-4 focus-within:ring-focus',
            disabled && 'pointer-events-none opacity-60',
          )}
          style={{ backgroundColor: swatch }}
        >
          <span className="sr-only">{C.pick}</span>
          <input
            type="color"
            value={swatch}
            disabled={disabled}
            onChange={(e) => commit(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={C.pick}
          />
        </label>

        <Input
          id={id}
          value={text}
          onChange={(e) => commit(e.target.value)}
          disabled={disabled}
          invalid={invalid}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="#1c64f2"
          aria-label={C.inputLabel}
          className="font-medium uppercase"
        />
      </div>

      {/* Preset swatches. */}
      <div className="mt-xs flex flex-col gap-2xs">
        <span className="text-xs font-medium text-foreground-subtle">{C.presetsLabel}</span>
        <div className="flex flex-wrap gap-xs">
          {COLOR_PRESETS.map((preset) => {
            const selected = isHexColor(value) && toLongHex(value).toLowerCase() === preset.toLowerCase();
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => commit(preset)}
                aria-label={preset}
                aria-pressed={selected}
                title={preset}
                className={cn(
                  'h-8 w-8 rounded-full border transition-transform duration-fast ease-standard',
                  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                  'hover:scale-110 active:scale-95',
                  selected ? 'border-foreground ring-2 ring-focus' : 'border-border',
                  disabled && 'pointer-events-none opacity-60',
                )}
                style={{ backgroundColor: preset }}
              />
            );
          })}
        </div>
      </div>

      {lowContrast ? (
        <p
          role="status"
          className="mt-xs flex items-start gap-2xs text-sm font-medium text-warning"
        >
          <WarningIcon />
          <span>{C.lowContrast}</span>
        </p>
      ) : null}
    </Field>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" aria-hidden="true">
      <path
        d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
