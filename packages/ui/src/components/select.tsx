'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '../cn';

/**
 * Select — an accessible single-choice dropdown built on Radix Select (keyboard
 * navigation, typeahead, focus management, scroll lock, ARIA listbox semantics
 * all handled by the primitive). Mirrors the Dialog wrapper's split-export shape.
 *
 * Tone maps onto design tokens only; no raw colors, spacing, radii, or motion
 * values live here. The trigger borrows the Input field's border/ring tokens so
 * a Select reads as a sibling of the other form controls. The panel fades in via
 * the `fade-in` keyframe and items crossfade their highlight on a token-timed
 * transition — both collapse to instant under `prefers-reduced-motion` (handled
 * globally in `globals.css`).
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  /** Swap the border/ring to the danger token for an invalid selection. */
  invalid?: boolean;
}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, invalid = false, children, 'aria-invalid': ariaInvalid, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    aria-invalid={ariaInvalid ?? invalid ?? undefined}
    className={cn(
      'flex h-12 w-full items-center justify-between gap-sm rounded-md border bg-surface px-md',
      'text-base text-foreground',
      'data-[placeholder]:text-foreground-subtle',
      'transition-[border-color,box-shadow] duration-fast ease-standard',
      'focus-visible:outline-none focus-visible:ring-4',
      'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
      invalid
        ? 'border-danger focus-visible:border-danger focus-visible:ring-focus-danger'
        : 'border-border focus-visible:border-primary focus-visible:ring-focus',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronIcon />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'z-50 max-h-[--radix-select-content-available-height] min-w-[--radix-select-trigger-width] overflow-hidden',
        'rounded-md border border-border bg-surface shadow-lg',
        'data-[state=open]:animate-fade-in',
        position === 'popper' && 'data-[side=bottom]:mt-2xs data-[side=top]:mb-2xs',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn('p-2xs', position === 'popper' && 'w-full')}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-sm rounded-xs py-sm pl-md pr-2xl',
      'text-base text-foreground outline-none',
      'transition-colors duration-fast ease-standard',
      'data-[highlighted]:bg-primary-subtle data-[highlighted]:text-primary',
      'data-[state=checked]:font-semibold',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-md flex items-center">
      <SelectPrimitive.ItemIndicator>
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-foreground-subtle" fill="none" aria-hidden="true">
      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 text-primary" fill="none" aria-hidden="true">
      <path d="M5 10.5 8.5 14 15 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
