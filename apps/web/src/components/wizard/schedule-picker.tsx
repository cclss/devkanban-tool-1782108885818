'use client';

/**
 * SchedulePicker — the reservation date/time control for scheduled send.
 *
 * A single native `datetime-local` input (styled with the shared `Input`/`Field`
 * primitives) that the sender uses to pick *when* a contract should auto-dispatch.
 * The future-only rule and the raw↔ISO normalization live in `lib/schedule-time`;
 * every label/hint lives in `lib/schedule-copy`. This component only owns
 * presentation + touched-reveal state, so it stays reusable and audit-clean.
 *
 * Contract with the parent:
 *   • `value`/`onChange` round-trip the raw `datetime-local` string (controlled).
 *   • `onValidityChange` hands up the derived {valid, iso, error} — the parent
 *     reads `iso` (UTC ISO-8601) for the API and `valid` to gate its send button.
 *   • `now` is captured once at mount (or injected) so `min` and validation share
 *     one clock; the native `min` attribute is a UX floor, never the sole guard.
 *
 * Errors stay quiet until the field is touched (blur) — matching the recipients
 * step — unless the parent forces a reveal via `showError` (e.g. on a send
 * attempt), so an untouched, empty picker never nags pre-emptively.
 */

import * as React from 'react';
import { Field, Input } from '@repo/ui';
import { scheduleErrorMessage, SCHEDULE_PICKER_COPY } from '@/lib/schedule-copy';
import {
  evaluateSchedule,
  toDateTimeLocalValue,
  type ScheduleValidity,
} from '@/lib/schedule-time';

export interface SchedulePickerProps {
  /** Raw `datetime-local` value (`YYYY-MM-DDTHH:mm`), controlled by the parent. */
  value: string;
  /** Raw value changes as the user edits. */
  onChange: (value: string) => void;
  /** Derived validity ({valid, iso, error}) whenever the value or clock changes. */
  onValidityChange?: (validity: ScheduleValidity) => void;
  /** Injectable clock; defaults to a single mount-time `Date`. */
  now?: Date;
  /** Force the inline hint to show even before the field is touched. */
  showError?: boolean;
  /** Control id; a message id is derived for `aria-describedby`. */
  id?: string;
  className?: string;
}

export function SchedulePicker({
  value,
  onChange,
  onValidityChange,
  now,
  showError = false,
  id = 'schedule-picker',
  className,
}: SchedulePickerProps) {
  // Anchor `min` and validation to one instant. Injected `now` wins; otherwise
  // freeze the mount time so re-renders don't shift the floor mid-edit.
  const anchor = React.useMemo(() => now ?? new Date(), [now]);

  const validity = React.useMemo(() => evaluateSchedule(value, anchor), [value, anchor]);

  const [touched, setTouched] = React.useState(false);

  // Surface the derived validity to the parent as it changes.
  React.useEffect(() => {
    onValidityChange?.(validity);
  }, [validity, onValidityChange]);

  const revealed = showError || touched;
  const message = revealed ? scheduleErrorMessage(validity.error) : null;
  const messageId = `${id}-message`;

  return (
    <Field
      label={SCHEDULE_PICKER_COPY.label}
      htmlFor={id}
      required
      error={message ?? undefined}
      hint={message ? undefined : SCHEDULE_PICKER_COPY.hint}
      className={className}
    >
      <Input
        id={id}
        type="datetime-local"
        value={value}
        min={toDateTimeLocalValue(anchor)}
        invalid={Boolean(message)}
        aria-describedby={messageId}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
    </Field>
  );
}
