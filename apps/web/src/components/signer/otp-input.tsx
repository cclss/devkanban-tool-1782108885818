'use client';

/**
 * OtpInput — segmented 6-digit verification code entry, mobile-first.
 *
 * Six single-character cells behave as one logical input:
 *   - typing a digit fills the cell and advances focus
 *   - Backspace clears, then steps back
 *   - ArrowLeft/Right move between cells
 *   - pasting a 6-digit string fills every cell at once
 *   - `inputMode="numeric"` summons the numeric keypad on mobile
 *
 * Stateless / controlled: the parent owns the `value` string and is notified via
 * `onChange`; `onComplete` fires once all cells are full. The `invalid` flag
 * paints the danger token and triggers a single shake (token-timed; collapses
 * under reduced-motion globally) — the parent bumps `shakeNonce` to replay it.
 *
 * Visual values come only from design tokens; no raw colors/spacing here.
 */

import * as React from 'react';
import { cn } from '@repo/ui';

export interface OtpInputProps {
  /** Number of cells. */
  length?: number;
  /** Current code (digits only, up to `length`). */
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last empty cell is filled (value has `length` digits). */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  /** Paint the danger state. */
  invalid?: boolean;
  /** Bump to replay the shake micro-interaction (e.g. on each failed attempt). */
  shakeNonce?: number;
  autoFocus?: boolean;
  /** Accessible label for the whole group. */
  'aria-label'?: string;
}

const DIGITS_ONLY = /\D+/g;

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  shakeNonce = 0,
  autoFocus = false,
  'aria-label': ariaLabel = '인증 코드',
}: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const cells = React.useMemo(() => Array.from({ length }), [length]);

  const focusCell = (index: number) => {
    const clamped = Math.max(0, Math.min(length - 1, index));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  };

  /** Apply a new full code, notify the parent, and signal completion. */
  const commit = (next: string) => {
    const clean = next.replace(DIGITS_ONLY, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(DIGITS_ONLY, '');
    if (!digits) {
      // Cleared the cell.
      const chars = value.split('');
      chars[index] = '';
      commit(chars.join(''));
      return;
    }
    // Take the latest typed digit (handles overwriting a filled cell), then
    // spill any extra digits (fast typists / partial paste) into later cells.
    const chars = value.split('');
    let cursor = index;
    for (const d of digits) {
      if (cursor >= length) break;
      chars[cursor] = d;
      cursor += 1;
    }
    commit(chars.join(''));
    focusCell(cursor);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const chars = value.split('');
      if (chars[index]) {
        chars[index] = '';
        commit(chars.join(''));
      } else if (index > 0) {
        chars[index - 1] = '';
        commit(chars.join(''));
        focusCell(index - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(DIGITS_ONLY, '');
    if (!pasted) return;
    const clean = commit(pasted);
    focusCell(clean.length);
  };

  return (
    <div
      // Re-keying on the nonce replays the shake animation cleanly each attempt.
      key={`shake-${shakeNonce}`}
      role="group"
      aria-label={ariaLabel}
      className={cn('flex justify-between gap-xs', invalid && 'animate-shake')}
    >
      {cells.map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- single intentional entry focus
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`${ariaLabel} ${i + 1}번째 자리`}
          aria-invalid={invalid || undefined}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={cn(
            'h-14 w-full min-w-0 rounded-md border bg-surface text-center',
            'text-2xl font-bold tabular-nums text-foreground caret-primary',
            'transition-[border-color,box-shadow] duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-4',
            'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
            invalid
              ? 'border-danger focus-visible:border-danger focus-visible:ring-focus-danger'
              : 'border-border-strong focus-visible:border-primary focus-visible:ring-focus',
          )}
        />
      ))}
    </div>
  );
}
