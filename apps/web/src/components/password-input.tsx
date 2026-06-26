'use client';

import * as React from 'react';
import { cn, Input, type InputProps } from '@repo/ui';

/**
 * PasswordInput — a password field with a Toss-signature reveal toggle.
 *
 * Shared by the login and signup screens so the auth-form shell stays
 * consistent: every password field gets the same show/hide control. The value
 * starts hidden (`type="password"`); the trailing button flips it to plain text
 * and back. The toggle is keyboard- and screen-reader-operable (`aria-pressed`
 * + an action-describing `aria-label`, a `focus-visible` ring, and `aria-controls`
 * pointing at the input). It inherits `disabled` so it can't fight the form's
 * loading state. Icon swap is a token-timed cross-fade that collapses under
 * `prefers-reduced-motion` (handled globally).
 */
export type PasswordInputProps = Omit<InputProps, 'type' | 'trailing'>;

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ id, disabled, ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false);

    return (
      <Input
        {...props}
        ref={ref}
        id={id}
        disabled={disabled}
        type={revealed ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            disabled={disabled}
            aria-pressed={revealed}
            aria-controls={id}
            aria-label={revealed ? '비밀번호 숨기기' : '비밀번호 표시'}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-xs',
              'text-foreground-subtle transition-colors duration-fast ease-standard hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <RevealIcon revealed={revealed} />
          </button>
        }
      />
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/**
 * Cross-fades between an open eye (value hidden — tap to show) and a struck-out
 * eye (value shown — tap to hide). Both icons are stacked and toggled by
 * opacity with a token-timed transition; decorative, so hidden from the a11y
 * tree (the button's `aria-label` carries the meaning).
 */
function RevealIcon({ revealed }: { revealed: boolean }) {
  return (
    <span className="relative block h-5 w-5" aria-hidden="true">
      <EyeIcon
        className={cn(
          'absolute inset-0 transition-opacity duration-fast ease-standard',
          revealed ? 'opacity-0' : 'opacity-100',
        )}
      />
      <EyeOffIcon
        className={cn(
          'absolute inset-0 transition-opacity duration-fast ease-standard',
          revealed ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-5 w-5', className)}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-5 w-5', className)}
    >
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
