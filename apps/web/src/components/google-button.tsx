'use client';

import * as React from 'react';
import { cn } from '@repo/ui';

/**
 * GoogleButton — the social-auth entry button for the login/signup screens.
 *
 * `@repo/ui` has no white "outline" Button tone, so this app-level component
 * absorbs the styling (per the grain boundary — we don't modify `@repo/ui`)
 * while mirroring the Button primitive's structure so it sits flush next to the
 * primary submit: same height/radius, token-timed transition, Toss "tap" press
 * (`active:scale`), and the shared `focus-visible` ring. The surface is the
 * Toss-signature white card-on-white with a subtle border.
 *
 * The visible `label` is the accessible name; the Google "G" mark is decorative
 * (`aria-hidden`). `isLoading` swaps the mark for a spinner and blocks input.
 */
export interface GoogleButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Screen-specific label, e.g. "Google로 로그인" / "Google로 시작하기". */
  label: string;
  /** Show a spinner and block interaction (popup open / code exchange). */
  isLoading?: boolean;
}

export const GoogleButton = React.forwardRef<HTMLButtonElement, GoogleButtonProps>(
  ({ className, label, isLoading = false, disabled, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={cn(
          'relative inline-flex h-14 w-full select-none items-center justify-center rounded-md',
          'border border-border bg-surface text-md font-semibold text-foreground',
          'transition-[transform,background-color,border-color,box-shadow] duration-fast ease-standard',
          'hover:bg-surface-muted active:scale-[0.97] active:bg-grey-100',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          'disabled:pointer-events-none disabled:opacity-40',
          className,
        )}
        {...props}
      >
        {/* Mark pinned left so the label stays optically centered. */}
        <span className="absolute left-lg flex items-center justify-center">
          {isLoading ? <Spinner /> : <GoogleMark />}
        </span>
        {label}
      </button>
    );
  },
);
GoogleButton.displayName = 'GoogleButton';

/**
 * Official Google "G" mark. The 4-color palette is fixed by Google's brand
 * guidelines and is an external brand asset — intentionally outside our color
 * Token Group (see `social-button` spec + audit). Decorative; the button's
 * `label` carries the accessible name.
 */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a12 12 0 0 0 0 10.76l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

/** Token-timed spinner; matches the Button primitive's loading mark. */
function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin text-foreground-subtle" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
