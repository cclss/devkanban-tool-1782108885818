'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../cn';
import {
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from './dialog';

/**
 * Sheet — an edge-anchored panel built on the same Radix Dialog primitive as
 * Dialog (so it inherits the focus trap, scroll lock and dismiss behaviour).
 * The default `side="bottom"` is the mobile BottomSheet used by the signer
 * flow; `right`/`left`/`top` cover desktop drawers.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogClose;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

type SheetSide = 'bottom' | 'top' | 'left' | 'right';

const sideClasses: Record<SheetSide, string> = {
  bottom:
    'inset-x-0 bottom-0 w-full rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1.5rem)] data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom',
  top: 'inset-x-0 top-0 w-full rounded-b-2xl data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom',
  right:
    'inset-y-0 right-0 h-full w-[min(24rem,90vw)] rounded-l-2xl data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
  left: 'inset-y-0 left-0 h-full w-[min(24rem,90vw)] rounded-r-2xl data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
};

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
  hideClose?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = 'bottom', hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 bg-surface p-xl shadow-xl focus:outline-none',
        sideClasses[side],
        className,
      )}
      {...props}
    >
      {side === 'bottom' ? (
        <div
          aria-hidden="true"
          className="mx-auto mb-md h-1 w-10 rounded-full bg-grey-300"
        />
      ) : null}
      {children}
      {!hideClose ? (
        <DialogClose
          aria-label="닫기"
          className={cn(
            'absolute right-md top-md flex h-9 w-9 items-center justify-center rounded-full',
            'text-foreground-subtle transition-colors duration-fast ease-standard',
            'hover:bg-grey-100 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          )}
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </DialogClose>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
));
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-xs pb-md', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

export const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-xs pt-lg', className)} {...props} />
);
SheetFooter.displayName = 'SheetFooter';
