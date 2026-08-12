/**
 * Scheduled-send picker copy — the single source of truth for the labels and
 * validation hints on the reservation date/time control (design-spec
 * `content/schedule-picker-form.md`).
 *
 * Kept here (mirroring `lib/new-contract-copy.ts` / `lib/settings-copy.ts`) so the
 * picker component stays presentational and every user-facing string is authored
 * and audited in one place — no wording scattered across JSX.
 *
 * Tone follows the project base voice and the established scheduled-send rejection
 * lines (`messages.ts` → `send.scheduledInPast`): plain 해요체, calm, never blaming
 * the user, one gentle "무슨 일 + 다음 행동" per hint. Each validation state points at
 * the exact next action so the message tells the user what to do, not just what
 * went wrong.
 */

import type { ScheduleErrorReason } from './schedule-time';

export const SCHEDULE_PICKER_COPY = {
  /** Field label above the date/time control. */
  label: '예약 일시',
  /** Neutral helper shown while the value is untouched or valid. */
  hint: '지금 이후 시각으로 예약할 수 있어요.',
  /**
   * Inline validation hints, keyed by why the chosen value is not acceptable.
   * Revealed only once the field is touched (or the parent forces a reveal).
   */
  error: {
    empty: '예약 일시를 선택해 주세요.',
    invalid: '올바른 날짜·시간을 선택해 주세요.',
    past: '지금 이후 시각으로 정해 주세요.',
  } satisfies Record<ScheduleErrorReason, string>,
} as const;

/** Map a validation reason to its inline hint. `null` (valid) ⇒ no message. */
export function scheduleErrorMessage(reason: ScheduleErrorReason | null): string | null {
  return reason ? SCHEDULE_PICKER_COPY.error[reason] : null;
}
