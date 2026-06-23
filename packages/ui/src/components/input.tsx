import * as React from 'react';
import { cn } from '../cn';

/**
 * Input — single-line text entry.
 *
 * `invalid` swaps the border/ring to the danger token so a field can express
 * its error state without bespoke styling.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid = false, 'aria-invalid': ariaInvalid, ...props }, ref) => (
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
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
