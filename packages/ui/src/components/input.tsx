import * as React from 'react';
import { cn } from '../cn';

/**
 * Input — single-line text entry.
 *
 * `invalid` swaps the border/ring to the danger token so a field can express
 * its error state without bespoke styling.
 *
 * `trailing` renders an adornment (e.g. a password reveal toggle) pinned to the
 * field's right edge. When provided, the control reserves right padding so the
 * value never slides under the adornment. Omitting it keeps the original
 * single-`<input>` DOM, so existing callers are unaffected.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Adornment pinned to the field's right edge (e.g. a reveal toggle button). */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid = false, trailing, 'aria-invalid': ariaInvalid, ...props }, ref) => {
    const control = (
      <input
        ref={ref}
        aria-invalid={ariaInvalid ?? invalid ?? undefined}
        className={cn(
          'h-12 w-full rounded-md border bg-surface px-md text-base text-foreground',
          'placeholder:text-foreground-subtle',
          'transition-[border-color,box-shadow] duration-fast ease-standard',
          'focus-visible:outline-none focus-visible:ring-4',
          'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
          invalid
            ? 'border-danger focus-visible:border-danger focus-visible:ring-focus-danger'
            : 'border-border focus-visible:border-primary focus-visible:ring-focus',
          // Reserve room for the adornment so the value never overlaps it.
          trailing ? 'pr-2xl' : null,
          className,
        )}
        {...props}
      />
    );

    if (!trailing) return control;

    return (
      <div className="relative">
        {control}
        <div className="absolute inset-y-0 right-xs flex items-center">{trailing}</div>
      </div>
    );
  },
);
Input.displayName = 'Input';
