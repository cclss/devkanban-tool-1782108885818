/**
 * Reservation-management logic — pure, DOM-free decisions the SCHEDULED detail's
 * ScheduleManager rests on when it reschedules or cancels a pending reservation.
 *
 * Kept out of the component (mirroring `lib/send-plan.ts` / `lib/schedule-time.ts`)
 * so the two things worth testing are verified without a DOM:
 *
 *   • `seedScheduleValue`  — turn the contract's current `scheduledSendAt` (UTC
 *                            ISO, or null) into the `datetime-local` string the
 *                            reschedule picker opens on, so 예약 변경 starts from the
 *                            existing reservation instead of a blank field. Falls
 *                            back to the default lead (now + 1h) when the stored
 *                            instant is missing or unparseable.
 *   • `runReschedule` /    — wrap the `documents.ts` API calls and normalize the
 *     `runCancel`            outcome into a discriminated result: on success the
 *                            server summary (still SCHEDULED after a reschedule,
 *                            back to DRAFT after a cancel); on failure the server's
 *                            verbatim rejection copy, or the neutral per-action
 *                            fallback when no server message is available.
 *
 * The component reads `ok` to decide "close + re-fetch the detail" vs "show the
 * message inline", and never has to know the ApiError shape.
 */

import { ApiError } from './api';
import { cancelSchedule, rescheduleContract, type DocumentSummary } from './documents';
import { SCHEDULE_MANAGE_COPY } from './schedule-copy';
import { defaultScheduleValue, toDateTimeLocalValue } from './schedule-time';

/**
 * Outcome of a reschedule/cancel attempt. `ok` success carries the server's
 * updated summary; failure carries a ready-to-render user-facing message.
 */
export type ScheduleActionResult =
  | { ok: true; document: DocumentSummary }
  | { ok: false; message: string };

/**
 * The `datetime-local` value the reschedule picker should open on: the current
 * reservation converted to local wall-clock (so the user edits their existing
 * time), or the default lead ahead of `now` when there is no usable current
 * instant. `now` is injected so the fallback is deterministic and testable.
 */
export function seedScheduleValue(scheduledSendAt: string | null, now: Date): string {
  if (scheduledSendAt) {
    const current = new Date(scheduledSendAt);
    if (!Number.isNaN(current.getTime())) {
      return toDateTimeLocalValue(current);
    }
  }
  return defaultScheduleValue(now);
}

/** Server rejection copy (verbatim) wins; else the neutral per-action fallback. */
function toFailure(error: unknown, fallback: string): ScheduleActionResult {
  const message = error instanceof ApiError && error.message ? error.message : fallback;
  return { ok: false, message };
}

/**
 * Reschedule the contract to a new future instant. On success the returned
 * summary is still SCHEDULED with the new `scheduledSendAt`; the caller re-fetches
 * the detail to reflect it. `iso` must already be a valid future UTC ISO string
 * (the picker's future-only rule is enforced in `schedule-time.ts`).
 */
export async function runReschedule(id: string, iso: string): Promise<ScheduleActionResult> {
  try {
    return { ok: true, document: await rescheduleContract(id, iso) };
  } catch (error) {
    return toFailure(error, SCHEDULE_MANAGE_COPY.feedback.rescheduleFailed);
  }
}

/**
 * Cancel the reservation. On success the returned summary is back to DRAFT
 * (`작성 중`) with the schedule cleared; the caller re-fetches the detail so the
 * screen leaves its SCHEDULED presentation.
 */
export async function runCancel(id: string): Promise<ScheduleActionResult> {
  try {
    return { ok: true, document: await cancelSchedule(id) };
  } catch (error) {
    return toFailure(error, SCHEDULE_MANAGE_COPY.feedback.cancelFailed);
  }
}
