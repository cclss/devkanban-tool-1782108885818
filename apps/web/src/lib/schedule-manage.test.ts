/**
 * Reservation-management logic unit tests.
 *
 * Covers the two decisions the ScheduleManager rests on:
 *   • seedScheduleValue — the reschedule picker opens on the *current* reservation
 *     (local wall-clock), and falls back to the default lead when there is no
 *     usable stored instant.
 *   • runReschedule / runCancel — success surfaces the server summary (still
 *     SCHEDULED after a reschedule; back to DRAFT after a cancel, proving the
 *     cancel → 작성 중 return), and failure surfaces the server's verbatim message
 *     or the neutral per-action fallback.
 *
 * The `documents.ts` API wrappers are mocked — these tests are about the outcome
 * we hand the component, not the network.
 */

import { runCancel, runReschedule, seedScheduleValue } from './schedule-manage';
import { cancelSchedule, rescheduleContract } from './documents';
import { ApiError } from './api';
import { SCHEDULE_MANAGE_COPY } from './schedule-copy';
import { defaultScheduleValue, toDateTimeLocalValue } from './schedule-time';

jest.mock('./documents', () => ({
  rescheduleContract: jest.fn(),
  cancelSchedule: jest.fn(),
}));

const mockReschedule = rescheduleContract as unknown as jest.Mock;
const mockCancel = cancelSchedule as unknown as jest.Mock;

const NOW = new Date('2026-08-12T09:00:00.000Z');
const FUTURE_ISO = '2026-08-20T05:00:00.000Z';

beforeEach(() => {
  mockReschedule.mockReset();
  mockCancel.mockReset();
});

describe('seedScheduleValue', () => {
  it('seeds the picker from the current reservation (local wall-clock)', () => {
    expect(seedScheduleValue(FUTURE_ISO, NOW)).toBe(toDateTimeLocalValue(new Date(FUTURE_ISO)));
  });

  it('falls back to the default lead when there is no stored instant', () => {
    expect(seedScheduleValue(null, NOW)).toBe(defaultScheduleValue(NOW));
  });

  it('falls back to the default lead when the stored instant is unparseable', () => {
    expect(seedScheduleValue('not-a-date', NOW)).toBe(defaultScheduleValue(NOW));
  });
});

describe('runReschedule', () => {
  it('resolves ok with the server summary (still SCHEDULED)', async () => {
    const summary = { id: 'doc-1', status: 'SCHEDULED', scheduledSendAt: FUTURE_ISO };
    mockReschedule.mockResolvedValue(summary);

    const result = await runReschedule('doc-1', FUTURE_ISO);

    expect(mockReschedule).toHaveBeenCalledWith('doc-1', FUTURE_ISO);
    expect(result).toEqual({ ok: true, document: summary });
  });

  it('surfaces the server rejection message verbatim on ApiError', async () => {
    mockReschedule.mockRejectedValue(new ApiError('예약 시각이 이미 지났어요.', 400));

    const result = await runReschedule('doc-1', FUTURE_ISO);

    expect(result).toEqual({ ok: false, message: '예약 시각이 이미 지났어요.' });
  });

  it('falls back to the neutral message when the failure carries none', async () => {
    mockReschedule.mockRejectedValue(new Error('network down'));

    const result = await runReschedule('doc-1', FUTURE_ISO);

    expect(result).toEqual({
      ok: false,
      message: SCHEDULE_MANAGE_COPY.feedback.rescheduleFailed,
    });
  });
});

describe('runCancel', () => {
  it('resolves ok with the server summary reverted to DRAFT', async () => {
    const summary = { id: 'doc-1', status: 'DRAFT', scheduledSendAt: null };
    mockCancel.mockResolvedValue(summary);

    const result = await runCancel('doc-1');

    expect(mockCancel).toHaveBeenCalledWith('doc-1');
    expect(result).toEqual({ ok: true, document: summary });
    expect(result.ok && result.document.status).toBe('DRAFT');
  });

  it('surfaces the server rejection message verbatim on ApiError', async () => {
    mockCancel.mockRejectedValue(new ApiError('예약된 계약이 아니에요.', 409));

    const result = await runCancel('doc-1');

    expect(result).toEqual({ ok: false, message: '예약된 계약이 아니에요.' });
  });

  it('falls back to the neutral message when the failure carries none', async () => {
    mockCancel.mockRejectedValue(new Error('network down'));

    const result = await runCancel('doc-1');

    expect(result).toEqual({ ok: false, message: SCHEDULE_MANAGE_COPY.feedback.cancelFailed });
  });
});
