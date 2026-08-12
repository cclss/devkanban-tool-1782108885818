/**
 * Send-plan logic unit tests — the immediate vs scheduled fork the review step
 * rests on, verified without a DOM or the network.
 *
 * Pins:
 *   • `buildSendBody` — an immediate send carries NO `scheduledSendAt` key (the
 *     body is byte-for-byte the pre-schedule shape); a scheduled send adds it.
 *     Recipient order is stamped from index and blank names are omitted.
 *   • `resolveScheduledSend` — toggle off ⇒ always submittable, no instant;
 *     toggle on ⇒ gated on a valid future instant, whose ISO is handed up.
 *   • `isScheduledResult` — reads the server-authored status to pick the screen.
 */

import {
  buildSendBody,
  isScheduledResult,
  resolveScheduledSend,
} from './send-plan';
import type { ScheduleValidity } from './schedule-time';
import type { RecipientDraft } from '@/components/wizard/wizard-context';

function recipient(over: Partial<RecipientDraft> & { id: string }): RecipientDraft {
  return { name: '', email: '', ...over } as RecipientDraft;
}

const ISO = '2026-08-12T02:00:00.000Z';

describe('buildSendBody', () => {
  it('omits scheduledSendAt entirely for an immediate send', () => {
    const body = buildSendBody([recipient({ id: 'a', email: 'a@x.com' })]);
    expect(body).toEqual({ recipients: [{ email: 'a@x.com', order: 0 }] });
    expect('scheduledSendAt' in body).toBe(false);
  });

  it('includes scheduledSendAt when a scheduled instant is supplied', () => {
    const body = buildSendBody([recipient({ id: 'a', email: 'a@x.com' })], ISO);
    expect(body).toEqual({
      recipients: [{ email: 'a@x.com', order: 0 }],
      scheduledSendAt: ISO,
    });
  });

  it('stamps signing order from index, trims fields, and omits blank names', () => {
    const body = buildSendBody([
      recipient({ id: 'a', name: '  김철수 ', email: ' a@x.com ' }),
      recipient({ id: 'b', name: '   ', email: 'b@x.com' }),
    ]);
    expect(body.recipients).toEqual([
      { email: 'a@x.com', name: '김철수', order: 0 },
      { email: 'b@x.com', order: 1 },
    ]);
  });
});

describe('resolveScheduledSend', () => {
  const valid: ScheduleValidity = { valid: true, iso: ISO, error: null };
  const past: ScheduleValidity = { valid: false, iso: null, error: 'past' };
  const empty: ScheduleValidity = { valid: false, iso: null, error: 'empty' };

  it('is always submittable with no instant when scheduling is off', () => {
    expect(resolveScheduledSend(false, null)).toEqual({
      canSubmit: true,
      scheduledSendAt: undefined,
    });
    // Even a stale/invalid validity is ignored while the toggle is off.
    expect(resolveScheduledSend(false, past)).toEqual({
      canSubmit: true,
      scheduledSendAt: undefined,
    });
  });

  it('hands up the ISO instant when scheduling on a valid future time', () => {
    expect(resolveScheduledSend(true, valid)).toEqual({
      canSubmit: true,
      scheduledSendAt: ISO,
    });
  });

  it('blocks submission when scheduling on a past / empty / missing time', () => {
    expect(resolveScheduledSend(true, past)).toEqual({
      canSubmit: false,
      scheduledSendAt: undefined,
    });
    expect(resolveScheduledSend(true, empty)).toEqual({
      canSubmit: false,
      scheduledSendAt: undefined,
    });
    expect(resolveScheduledSend(true, null)).toEqual({
      canSubmit: false,
      scheduledSendAt: undefined,
    });
  });

  it('does not trust a valid flag paired with a null iso (defensive)', () => {
    const inconsistent: ScheduleValidity = { valid: true, iso: null, error: null };
    expect(resolveScheduledSend(true, inconsistent)).toEqual({
      canSubmit: false,
      scheduledSendAt: undefined,
    });
  });
});

describe('isScheduledResult', () => {
  it('is true only when the server parked the contract as SCHEDULED', () => {
    expect(isScheduledResult({ status: 'SCHEDULED' })).toBe(true);
    expect(isScheduledResult({ status: 'IN_PROGRESS' })).toBe(false);
    expect(isScheduledResult({ status: 'DRAFT' })).toBe(false);
  });
});
