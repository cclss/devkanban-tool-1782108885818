'use client';

/**
 * FontSelect — the predefined signer-screen font dropdown.
 *
 * A thin binding of the `@repo/ui` Select primitive (accessible listbox,
 * keyboard nav, typeahead) to the `FONT_CATALOG` single source. Each option
 * renders its label in its own family so the choice previews itself; the
 * trigger shows the current selection the same way.
 */

import * as React from 'react';
import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import { BRANDING_COPY, FONT_CATALOG, fontOption, type BrandFont } from '@/lib/branding-settings';

export function FontSelect({
  value,
  onChange,
  disabled = false,
  id = 'brand-font',
}: {
  value: BrandFont;
  onChange: (next: BrandFont) => void;
  disabled?: boolean;
  id?: string;
}) {
  const current = fontOption(value);

  return (
    <Field label={BRANDING_COPY.font.label} htmlFor={id} hint={BRANDING_COPY.font.hint}>
      <Select value={value} onValueChange={(v) => onChange(v as BrandFont)} disabled={disabled}>
        <SelectTrigger id={id} aria-label={BRANDING_COPY.font.label}>
          <SelectValue placeholder={BRANDING_COPY.font.placeholder}>
            <span className={current.className}>{current.label}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FONT_CATALOG.map((font) => (
            <SelectItem key={font.value} value={font.value}>
              <span className="flex flex-col gap-2xs">
                <span className={`text-base ${font.className}`}>{font.label}</span>
                <span className="text-xs text-foreground-subtle">{font.note}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
