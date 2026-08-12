/**
 * Scheduled-send date/time logic — pure, DOM-free, and the single source of truth
 * for "is this reservation time valid?".
 *
 * The picker UI is a native `datetime-local` control, so the value it round-trips
 * is a local, timezone-less wall-clock string `YYYY-MM-DDTHH:mm` (minute
 * precision). This module turns that raw string into a decision the UI and the
 * parent can both trust:
 *
 *   • empty      — nothing chosen yet (still invalid, prompts selection),
 *   • invalid    — a value we cannot parse into a real instant,
 *   • past       — a real instant that is now-or-earlier (the rule is *future*),
 *   • valid       — a real, strictly-future instant → normalized to a UTC ISO
 *                   string for the API contract (`scheduledSendAt`).
 *
 * Kept separate from the component (mirroring `lib/recipients.ts` /
 * `lib/field-geometry.ts`) so the future-only rule is unit-tested without a DOM,
 * and the same helpers back both the control's `min` attribute and its validation.
 *
 * `now` is always injected (never read from the clock here) so the rule is
 * deterministic and testable; the component passes a single mount-time `Date`.
 */

/** Why a chosen schedule time is not (yet) acceptable. `null` error ⇒ valid. */
export type ScheduleErrorReason = 'empty' | 'invalid' | 'past';

export interface ScheduleValidity {
  /** True only for a real, strictly-future instant. */
  valid: boolean;
  /** UTC ISO-8601 string when `valid`; otherwise null. This is the value handed up. */
  iso: string | null;
  /** Why it is not valid, or null when it is. Maps to copy for the inline hint. */
  error: ScheduleErrorReason | null;
}

/** A datetime-local value must be `YYYY-MM-DDTHH:mm` (seconds optional). */
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Classify a raw `datetime-local` string against `now`.
 *
 * Equality with `now` counts as `past`: a reservation must be *after* the
 * current instant, never at it.
 */
export function evaluateSchedule(rawValue: string, now: Date): ScheduleValidity {
  const value = rawValue.trim();
  if (value === '') {
    return { valid: false, iso: null, error: 'empty' };
  }

  // Guard the shape before trusting Date parsing: `new Date('2026-08')` and other
  // partials parse to *something*, which would let a date-only value slip through.
  if (!DATETIME_LOCAL_PATTERN.test(value)) {
    return { valid: false, iso: null, error: 'invalid' };
  }

  // A `datetime-local` string has no zone, so JS reads it as local wall-clock time
  // — exactly what the user picked. Real calendar rollovers (e.g. 02-30) surface
  // as NaN here.
  const picked = new Date(value);
  if (Number.isNaN(picked.getTime())) {
    return { valid: false, iso: null, error: 'invalid' };
  }

  if (picked.getTime() <= now.getTime()) {
    return { valid: false, iso: null, error: 'past' };
  }

  return { valid: true, iso: picked.toISOString(), error: null };
}

/** Zero-pad to two digits for the `datetime-local` wire format. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format a `Date` as a local `YYYY-MM-DDTHH:mm` string — the shape a native
 * `datetime-local` input reads/writes. Used for the control's `min` (floor at
 * `now`) and to seed a sensible default. Uses local getters so the wall-clock the
 * user sees matches the wall-clock the browser would render.
 */
export function toDateTimeLocalValue(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** Default lead used when suggesting an initial reservation time: one hour ahead. */
export const DEFAULT_SCHEDULE_LEAD_MINUTES = 60;

/**
 * Suggest an initial reservation value: `now` pushed `leadMinutes` into the
 * future and floored to the minute (datetime-local precision), so a freshly
 * enabled picker starts on a guaranteed-valid, human-round time instead of the
 * disallowed present instant.
 */
export function defaultScheduleValue(now: Date, leadMinutes = DEFAULT_SCHEDULE_LEAD_MINUTES): string {
  const seed = new Date(now.getTime());
  seed.setSeconds(0, 0);
  seed.setMinutes(seed.getMinutes() + leadMinutes);
  return toDateTimeLocalValue(seed);
}
