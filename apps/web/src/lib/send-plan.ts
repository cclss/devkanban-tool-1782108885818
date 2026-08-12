/**
 * Send-plan logic — pure, DOM-free decisions the review step rests on when it
 * dispatches a contract either now or on a schedule.
 *
 * Kept out of the component (mirroring `lib/schedule-time.ts` / `lib/recipients.ts`)
 * so the two forks — immediate vs scheduled — are unit-tested without a DOM:
 *
 *   • `buildSendBody`   — the exact JSON body `POST /documents/:id/send` receives.
 *                         Adds `scheduledSendAt` only when scheduling, so the
 *                         immediate path stays byte-for-byte what it was before.
 *   • `resolveScheduledSend` — given the toggle + picker validity, decides whether
 *                         a send may be attempted and which ISO instant (if any)
 *                         to hand the API. The picker's future-only rule lives in
 *                         `schedule-time.ts`; this only reads its verdict.
 *   • `isScheduledResult` — reads the server's returned summary to pick the
 *                         completion screen (예약 완료 vs 즉시 발송 완료). The status
 *                         is authored server-side, so it is the reliable signal.
 */

import type { ScheduleValidity } from './schedule-time';
import type { DocumentStatus } from './documents';
import type { RecipientDraft } from '@/components/wizard/wizard-context';

/** One recipient as the send endpoint expects it (signing order stamped). */
export interface RecipientPayload {
  email: string;
  name?: string;
  order: number;
}

/** The full body for `POST /documents/:id/send`. */
export interface SendContractBody {
  recipients: RecipientPayload[];
  /** ISO instant to auto-send at; present only for a scheduled send. */
  scheduledSendAt?: string;
}

/**
 * Assemble the send body. Recipient array order *is* the signing order, so we
 * stamp an explicit `order` from the index; a blank name is omitted (optional
 * server-side) rather than sent as an empty string. `scheduledSendAt` is added
 * only when provided — an immediate send carries no schedule key at all.
 */
export function buildSendBody(
  recipients: RecipientDraft[],
  scheduledSendAt?: string,
): SendContractBody {
  const payload: RecipientPayload[] = recipients.map((r, i) => {
    const name = r.name.trim();
    return {
      email: r.email.trim(),
      ...(name ? { name } : {}),
      order: i,
    };
  });
  return {
    recipients: payload,
    ...(scheduledSendAt ? { scheduledSendAt } : {}),
  };
}

/** The review step's send decision derived from the schedule toggle + picker. */
export interface ScheduledSendDecision {
  /**
   * Whether a send may be attempted for the schedule gate alone. Always true for
   * an immediate send; for a scheduled send, true only when the picked instant is
   * a real, strictly-future time. (The caller still ANDs this with the base
   * document/fields/recipients gate.)
   */
  canSubmit: boolean;
  /** ISO instant to schedule for, or undefined for an immediate send. */
  scheduledSendAt: string | undefined;
}

/**
 * Decide the schedule fork from the toggle state and the picker's validity.
 *
 * Off ⇒ immediate send, always submittable, no schedule instant. On ⇒ gated on a
 * valid future instant; only then is its ISO handed up for the API.
 */
export function resolveScheduledSend(
  scheduled: boolean,
  validity: ScheduleValidity | null,
): ScheduledSendDecision {
  if (!scheduled) {
    return { canSubmit: true, scheduledSendAt: undefined };
  }
  const iso = validity?.valid === true ? validity.iso : null;
  return iso
    ? { canSubmit: true, scheduledSendAt: iso }
    : { canSubmit: false, scheduledSendAt: undefined };
}

/**
 * True when the server parked the contract as 예약됨 rather than dispatching now —
 * the signal for showing the scheduled completion screen. Status is authored
 * server-side (single source of truth), so it is trusted over any local flag.
 */
export function isScheduledResult(summary: { status: DocumentStatus }): boolean {
  return summary.status === 'SCHEDULED';
}
