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

/**
 * Scheduled-send copy for the review step — the '예약 발송' toggle, the send
 * button's schedule variant, and the reservation-confirmed takeover shown once
 * the contract is parked as 예약됨 (distinct from the immediate 발송 완료 screen).
 *
 * Same voice as the picker copy and the immediate success screen: plain 해요체,
 * calm, celebratory on completion, telling the user what happens next. The
 * reservation instant itself is rendered separately via `scheduledSendMetaText`
 * (todo-copy), so no date format lives here.
 */
export const SCHEDULE_SEND_COPY = {
  /** The toggle that reveals the picker and switches send into schedule mode. */
  toggle: {
    label: '예약 발송',
    description: '지정한 시각에 자동으로 보내드릴게요.',
  },
  /** Send-button labels for the schedule fork (mirrors the immediate 발송/발송 중). */
  action: {
    /** Idle / retry label when scheduling is on. */
    schedule: '예약 발송',
    /** In-flight label while the reservation is being registered. */
    scheduling: '예약 중',
  },
  /** The reservation-confirmed takeover (parallels the immediate SendSuccess). */
  success: {
    title: '예약 발송을 설정했어요!',
    body: '지정한 시각이 되면 자동으로 보낼게요. 예약 상태는 대시보드에서 확인할 수 있어요.',
    cta: '대시보드로 가기',
  },
} as const;
