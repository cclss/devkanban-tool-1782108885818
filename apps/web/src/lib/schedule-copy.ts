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

/**
 * Reservation-management copy — the single source of truth for the strings the
 * dashboard uses to change or cancel a pending 예약됨 contract from its detail
 * screen or card menu (design-spec `content/message-schedule-manage-ui.md`). The
 * API wiring lives in `lib/documents.ts` (`rescheduleContract` / `cancelSchedule`);
 * the components stay presentational and reference these labels only.
 *
 * Two established tones meet here:
 *   • confirm-dialog (`components/confirm-dialog/base.md`, mirrored by the template
 *     delete confirm): a `~할까요?` question title, a body that names the
 *     consequence plainly then reassures, a calm way out.
 *   • scheduled-send 해요체 (`messages.ts` → `send.*`, `SCHEDULE_SEND_COPY`): calm,
 *     never blaming, one gentle "무슨 일 + 다음 행동" per line.
 *
 * The cancel body spells out the DRAFT return in the server's user-facing word for
 * that status — 작성 중 — and reassures the contract's contents survive, so the
 * user knows cancelling is reversible, not destructive. Because the destructive
 * action itself is "취소", the dialog's way-out button is 닫기 (not 취소) to avoid
 * two 취소 meanings sitting side by side.
 */
export const SCHEDULE_MANAGE_COPY = {
  /**
   * The reservation-management block shown on a SCHEDULED contract's detail
   * screen: a heading and the label for the reservation-instant row (the instant
   * itself renders separately via `formatScheduledSendAt`, so no date shape lives
   * here). Mirrors the detail SummaryCard's dt/dd labelling.
   */
  section: {
    /** Heading of the management block. */
    title: '예약 발송',
    /** Label of the reservation-instant row (value rendered separately). */
    instantLabel: '예약 일시',
  },
  /** Actions offered on a scheduled contract (detail screen / card menu). */
  action: {
    /** Open the reschedule picker. */
    reschedule: '예약 변경',
    /** Open the cancel-confirm dialog. */
    cancel: '예약 취소',
  },
  /**
   * Reschedule modal — the picker dialog opened by 예약 변경, seeded with the
   * current reservation. Its way-out button is 닫기 (not 취소) for the same reason
   * the cancel dialog uses 닫기: this dialog is *about* the reservation, so a 취소
   * button would read as "예약 취소" and collide with the separate cancel flow.
   */
  rescheduleDialog: {
    /** Title of the picker dialog. */
    title: '예약 일시 변경',
    /** Confirm the new instant (a primary action). */
    confirm: '예약 변경',
    /** In-flight label while the new instant is being applied. */
    rescheduling: '변경 중',
    /** Dismiss without changing — 닫기, mirroring the cancel dialog. */
    dismiss: '닫기',
  },
  /** Cancel-confirm modal (parallels the template delete confirm). */
  cancelDialog: {
    title: '예약을 취소할까요?',
    /** Consequence (→ 작성 중 / DRAFT 복귀) stated plainly, then reassurance. */
    description:
      '취소하면 예약 발송이 해제되고 계약이 작성 중으로 돌아가요. 작성한 내용은 그대로 있어서 언제든 다시 보내거나 예약할 수 있어요.',
    /** Confirm the cancellation (a `danger` action in the UI). */
    confirm: '예약 취소',
    /** In-flight label while the cancellation is being applied. */
    cancelling: '취소 중',
    /** Dismiss without cancelling — 닫기, not 취소, to avoid the doubled 취소. */
    dismiss: '닫기',
  },
  /**
   * Post-action feedback tone (toast/banner). Server rejection copy surfaces
   * verbatim via `ApiError`; these are the success lines and the neutral failure
   * fallback for each action, in the same 해요체 "무슨 일 + 다음 행동" voice.
   */
  feedback: {
    /** Reschedule succeeded — the new instant renders separately on the card. */
    rescheduled: '예약 일시를 바꿨어요.',
    /** Cancel succeeded — names the DRAFT (작성 중) return so the move is clear. */
    cancelled: '예약을 취소하고 작성 중으로 옮겼어요.',
    rescheduleFailed: '예약 일시를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
    cancelFailed: '예약을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.',
  },
} as const;
