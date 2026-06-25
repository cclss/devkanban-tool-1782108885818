import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

/**
 * Button — the primary action primitive.
 *
 * Tone (`variant`) and `size` map onto design tokens only; no raw values live
 * here. Motion: a token-timed color transition plus an `active:scale` press
 * that reads as the Toss "tap" feel. The press collapses to nothing under
 * `prefers-reduced-motion` (handled globally).
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-xs select-none',
    'font-semibold whitespace-nowrap rounded-md',
    'transition-[transform,background-color,color,box-shadow] duration-fast ease-standard',
    'active:scale-[0.97]',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed',
        secondary:
          'bg-surface-muted text-foreground border border-border hover:bg-grey-100 active:bg-grey-200',
        ghost: 'bg-transparent text-foreground-muted hover:bg-grey-100 active:bg-grey-200',
        danger: 'bg-danger text-danger-foreground hover:brightness-95 active:brightness-90',
      },
      size: {
        sm: 'h-9 px-md text-sm',
        md: 'h-11 px-lg text-base',
        lg: 'h-14 px-xl text-md',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (Radix Slot) — e.g. wrap an `<a>`. */
  asChild?: boolean;
  /** Show a spinner and block interaction. */
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, fullWidth, asChild = false, isLoading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <>
            <Spinner />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export { buttonVariants };
