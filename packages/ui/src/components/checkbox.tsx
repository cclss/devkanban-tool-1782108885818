import * as React from 'react';
import { cn } from '../cn';

/**
 * Checkbox — labelled, accessible boolean control.
 *
 * A visually-hidden native `<input type="checkbox">` carries the semantics
 * (focus, Space-to-toggle, `aria-checked`, screen-reader announcement) while a
 * sibling box renders the visual state. Driving everything off the native input
 * via `peer-*` keeps keyboard and assistive-tech behaviour for free.
 *
 * Tone maps onto design tokens only; no raw colors, spacing, radii, or motion
 * values live here. Motion: the tick eases in with a soft `bounce` scale (the
 * Toss "pop") and the box color crossfades on a token-timed transition. Both
 * collapse to a static end-state under `prefers-reduced-motion` (handled
 * globally in `globals.css`).
 *
 * `invalid` swaps the border/ring/checked-fill to the danger token so a terms
 * agreement (or any required checkbox) can express its error state without
 * bespoke styling — mirroring `Input`'s `invalid` prop.
 *
 * The label text — plain copy or inline links (terms / privacy) — is provided
 * as `children`; the whole row is a `<label>`, so clicking the copy toggles the
 * box.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Render border/ring/fill in the danger tone for an unmet requirement. */
  invalid?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    { className, invalid = false, disabled, children, id, 'aria-invalid': ariaInvalid, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    return (
      <label
        htmlFor={inputId}
        className={cn(
          'inline-flex items-start gap-sm text-base text-foreground-muted',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          className,
        )}
      >
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          disabled={disabled}
          aria-invalid={ariaInvalid ?? invalid ?? undefined}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border bg-surface',
            'transition-[background-color,border-color,box-shadow] duration-fast ease-standard',
            'peer-focus-visible:ring-4',
            // Soft tick reveal: scale + fade in with the bounce easing on check.
            'peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100',
            invalid
              ? 'border-danger peer-checked:border-danger peer-checked:bg-danger peer-focus-visible:ring-focus-danger'
              : 'border-border-strong peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:border-primary peer-focus-visible:ring-focus',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              'h-3.5 w-3.5 scale-50 text-primary-foreground opacity-0',
              'transition-[transform,opacity] duration-base ease-bounce',
            )}
          >
            <path
              d="M3.5 8.5 6.75 11.75 12.5 4.75"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {children ? <span className="select-none leading-relaxed">{children}</span> : null}
      </label>
    );
  },
);
Checkbox.displayName = 'Checkbox';
