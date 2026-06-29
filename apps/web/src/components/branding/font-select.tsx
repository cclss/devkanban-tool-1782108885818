'use client';

/**
 * FontSelect — brand font dropdown.
 *
 * A custom listbox (not a native `<select>`) so each option can render in its
 * own typeface — the whole point of choosing a brand font. Fully keyboard
 * operable (Arrow/Home/End/Enter/Escape, type-to-select is intentionally
 * omitted to keep it simple) with roving `aria-activedescendant`. The webfont
 * for each option is loaded on open so the previews are faithful.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import {
  BRANDING_COPY,
  BRAND_FONT_CATALOG,
  ensureBrandFontLoaded,
  getBrandFont,
  type BrandFont,
} from '@/lib/branding';

const F = BRANDING_COPY.font;

export function FontSelect({
  value,
  onChange,
  fonts = BRAND_FONT_CATALOG,
  disabled,
  id = 'brand-font',
}: {
  value: string;
  onChange: (key: string) => void;
  fonts?: readonly BrandFont[];
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const selected = getBrandFont(value);
  const selectedIndex = Math.max(
    0,
    fonts.findIndex((f) => f.key === value),
  );

  // Load every option's webfont once the list is shown, so each renders true,
  // reset the active option to the current selection, and move focus to the list.
  React.useEffect(() => {
    if (!open) return;
    fonts.forEach((f) => ensureBrandFontLoaded(f.key));
    setActiveIndex(selectedIndex);
    listRef.current?.focus();
  }, [open, fonts, selectedIndex]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const choose = (index: number) => {
    const font = fonts[index];
    if (!font) return;
    onChange(font.key);
    close(true);
  };

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(fonts.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(fonts.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  };

  const listId = `${id}-listbox`;
  const labelId = `${id}-label`;

  return (
    <div className="flex flex-col gap-xs">
      <span id={labelId} className="text-sm font-semibold text-foreground-muted">
        {F.label}
      </span>

      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onButtonKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${id}`}
          className={cn(
            'flex h-12 w-full items-center justify-between gap-sm rounded-md border bg-surface px-md text-left',
            'transition-[border-color,box-shadow] duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus focus-visible:border-primary',
            'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
            open ? 'border-primary' : 'border-border',
          )}
        >
          <span
            className="truncate text-base text-foreground"
            style={{ fontFamily: selected.fontFamily }}
          >
            {selected.label}
          </span>
          <ChevronIcon open={open} />
        </button>

        {open ? (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={`${id}-opt-${activeIndex}`}
            onKeyDown={onListKeyDown}
            className={cn(
              'absolute z-40 mt-2xs max-h-72 w-full overflow-auto rounded-md border border-border bg-surface p-2xs shadow-lg',
              'animate-fade-in',
            )}
          >
            {fonts.map((font, index) => {
              const isSelected = font.key === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={font.key}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => choose(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-sm rounded-sm px-sm py-xs',
                    isActive ? 'bg-primary-subtle' : 'bg-transparent',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="truncate text-base text-foreground"
                      style={{ fontFamily: font.fontFamily }}
                    >
                      {font.label}
                    </span>
                    <span
                      className="truncate text-xs text-foreground-subtle"
                      style={{ fontFamily: font.fontFamily }}
                    >
                      {F.sample}
                    </span>
                  </span>
                  {isSelected ? <CheckIcon /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <p className="text-sm text-foreground-subtle">{F.hint}</p>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn(
        'h-5 w-5 shrink-0 text-grey-400 transition-transform duration-fast ease-standard',
        open && 'rotate-180',
      )}
      fill="none"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-primary" fill="none" aria-hidden="true">
      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
