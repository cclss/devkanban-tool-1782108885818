'use client';

import * as React from 'react';
import { cn } from '@repo/ui';

/**
 * PasswordStrengthMeter — a real-time strength gauge for a new-password field.
 *
 * Three tiers (약함 / 보통 / 강함) are derived from length and character variety
 * and surfaced two ways at once: a segmented bar that fills + recolors, and a
 * text label. The label lives in an `aria-live="polite"` region so screen-reader
 * users hear the tier change as they type — the bar is purely decorative
 * (`aria-hidden`). Every color comes from the status tokens (danger / warning /
 * success) and every size/gap/radius from the spacing & radius tokens; the bar
 * recolor uses a token-timed transition that collapses under
 * `prefers-reduced-motion` (handled globally in `globals.css`).
 *
 * The meter is advisory only — it never blocks submission. The hard rule
 * (`@MinLength(8)`, mirrored client-side) is enforced by the field's own
 * validation; anything shorter than the server minimum is always shown as 약함.
 */

export type PasswordStrength = 'weak' | 'medium' | 'strong';

type StrengthMeta = {
  /** Korean tier label woven into the live-region announcement. */
  label: string;
  /** How many of the {@link SEGMENTS} bars are lit at this tier. */
  filled: number;
  /** Filled-segment color token. */
  bar: string;
  /** Label color token. */
  text: string;
};

const STRENGTH_META: Record<PasswordStrength, StrengthMeta> = {
  weak: { label: '약함', filled: 1, bar: 'bg-danger', text: 'text-danger' },
  medium: { label: '보통', filled: 2, bar: 'bg-warning', text: 'text-warning' },
  strong: { label: '강함', filled: 3, bar: 'bg-success', text: 'text-success' },
};

/** One bar per tier, so a full bar reads as "강함" at a glance. */
const SEGMENTS = 3;

/**
 * Classify a password into one of three tiers.
 *
 * Anything below the server minimum (`@MinLength(8)`) is always 약함 — a short
 * password can't be "strong" no matter its variety. Past that, points accrue for
 * extra length and for mixing character classes (case, digits, symbols).
 */
export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < 8) return 'weak';

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}

export interface PasswordStrengthMeterProps {
  /** The current password text; empty renders an idle, neutral meter. */
  password: string;
  /** Optional id so the field can point `aria-describedby` at the meter. */
  id?: string;
  className?: string;
}

export function PasswordStrengthMeter({ password, id, className }: PasswordStrengthMeterProps) {
  const strength = password ? evaluatePasswordStrength(password) : null;
  const meta = strength ? STRENGTH_META[strength] : null;
  const filled = meta?.filled ?? 0;

  return (
    <div id={id} className={cn('flex flex-col gap-2xs', className)}>
      <div className="flex items-center gap-2xs" aria-hidden="true">
        {Array.from({ length: SEGMENTS }).map((_, index) => (
          <span
            key={index}
            className={cn(
              'h-2xs flex-1 rounded-xs transition-colors duration-base ease-standard',
              index < filled ? meta!.bar : 'bg-border',
            )}
          />
        ))}
      </div>
      {/* Persistent live region (always mounted, fixed height) so the tier change
          is announced rather than the node being freshly inserted. */}
      <p
        aria-live="polite"
        className={cn(
          'min-h-[1.25rem] text-sm font-medium',
          meta ? meta.text : 'text-foreground-subtle',
        )}
      >
        {meta ? `비밀번호 강도: ${meta.label}` : ''}
      </p>
    </div>
  );
}
