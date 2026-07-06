import { DocumentStatus, SignRequestStatus } from '@repo/db';
import {
  DUE_SOON_DAYS,
  NextAction,
  OVERDUE_DAYS,
  Urgency,
  countPendingSigners,
  deriveNextAction,
  deriveUrgency,
} from './document-todo';

/** Fixed "now" so every case is deterministic. */
const NOW = new Date('2026-07-06T12:00:00.000Z');

/** A `sentAt` exactly `days` (+ optional hours) before NOW. */
function sentDaysAgo(days: number, extraHours = 0): Date {
  return new Date(NOW.getTime() - (days * 24 + extraHours) * 60 * 60 * 1000);
}

describe('thresholds', () => {
  it('are exported as named, adjustable constants forming a [5, 7] window', () => {
    expect(DUE_SOON_DAYS).toBe(5);
    expect(OVERDUE_DAYS).toBe(7);
    expect(DUE_SOON_DAYS).toBeLessThan(OVERDUE_DAYS);
  });
});

describe('deriveUrgency — IN_PROGRESS boundaries', () => {
  it('is NORMAL just under the DUE_SOON window (4 days)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(4), NOW)).toBe(
      Urgency.NORMAL,
    );
  });

  it('is DUE_SOON at exactly 5 days (inclusive lower bound)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(5), NOW)).toBe(
      Urgency.DUE_SOON,
    );
  });

  it('is DUE_SOON at 6 days (mid-window)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(6), NOW)).toBe(
      Urgency.DUE_SOON,
    );
  });

  it('is DUE_SOON at exactly 7 days (inclusive upper bound, not yet overdue)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(7), NOW)).toBe(
      Urgency.DUE_SOON,
    );
  });

  it('is still DUE_SOON just past 7 days but under 8 (7d 12h → floors to 7)', () => {
    expect(
      deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(7, 12), NOW),
    ).toBe(Urgency.DUE_SOON);
  });

  it('is OVERDUE at exactly 8 days (strictly more than 7 whole days)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(8), NOW)).toBe(
      Urgency.OVERDUE,
    );
  });

  it('is OVERDUE far past the window (30 days)', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, sentDaysAgo(30), NOW)).toBe(
      Urgency.OVERDUE,
    );
  });

  it('is NORMAL when sentAt is null even though status is IN_PROGRESS', () => {
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, null, NOW)).toBe(
      Urgency.NORMAL,
    );
  });

  it('is NORMAL for a future sentAt (clock skew floors elapsed to 0)', () => {
    const future = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(deriveUrgency(DocumentStatus.IN_PROGRESS, future, NOW)).toBe(
      Urgency.NORMAL,
    );
  });
});

describe('deriveUrgency — non-IN_PROGRESS statuses are always NORMAL', () => {
  // Even with a very old sentAt, a non-IN_PROGRESS document is never urgent.
  const old = sentDaysAgo(90);

  it('DRAFT → NORMAL', () => {
    expect(deriveUrgency(DocumentStatus.DRAFT, old, NOW)).toBe(Urgency.NORMAL);
  });

  it('COMPLETED → NORMAL', () => {
    expect(deriveUrgency(DocumentStatus.COMPLETED, old, NOW)).toBe(
      Urgency.NORMAL,
    );
  });

  it('CANCELLED → NORMAL (explicit decision)', () => {
    expect(deriveUrgency(DocumentStatus.CANCELLED, old, NOW)).toBe(
      Urgency.NORMAL,
    );
  });
});

describe('deriveNextAction — full status mapping', () => {
  it('DRAFT → SEND_DRAFT', () => {
    expect(deriveNextAction(DocumentStatus.DRAFT)).toBe(NextAction.SEND_DRAFT);
  });

  it('IN_PROGRESS → AWAITING_SIGN', () => {
    expect(deriveNextAction(DocumentStatus.IN_PROGRESS)).toBe(
      NextAction.AWAITING_SIGN,
    );
  });

  it('COMPLETED → DOWNLOAD', () => {
    expect(deriveNextAction(DocumentStatus.COMPLETED)).toBe(
      NextAction.DOWNLOAD,
    );
  });

  it('CANCELLED → null (defined fallback: no actionable next step)', () => {
    expect(deriveNextAction(DocumentStatus.CANCELLED)).toBeNull();
  });

  it('covers every DocumentStatus enum member', () => {
    for (const status of Object.values(DocumentStatus)) {
      const action = deriveNextAction(status);
      // Either a defined NextAction or the explicit null fallback — never undefined.
      expect(
        action === null || Object.values(NextAction).includes(action),
      ).toBe(true);
    }
  });
});

describe('countPendingSigners', () => {
  it('counts PENDING and VIEWED as pending', () => {
    expect(
      countPendingSigners([
        SignRequestStatus.PENDING,
        SignRequestStatus.VIEWED,
      ]),
    ).toBe(2);
  });

  it('does not count SIGNED or DECLINED (resolved outcomes)', () => {
    expect(
      countPendingSigners([
        SignRequestStatus.SIGNED,
        SignRequestStatus.DECLINED,
      ]),
    ).toBe(0);
  });

  it('counts only the unresolved signers in a mixed set', () => {
    expect(
      countPendingSigners([
        SignRequestStatus.PENDING, // pending
        SignRequestStatus.VIEWED, // pending
        SignRequestStatus.SIGNED, // done
        SignRequestStatus.DECLINED, // resolved
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty list', () => {
    expect(countPendingSigners([])).toBe(0);
  });
});
