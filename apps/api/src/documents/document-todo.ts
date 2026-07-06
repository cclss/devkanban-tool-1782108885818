import { DocumentStatus, SignRequestStatus } from '@repo/db';

/**
 * Pure TO-DO derivation logic for the dashboard.
 *
 * These helpers turn a document's *existing* persisted fields (`status`,
 * `sentAt`) and its sign-request statuses into the derived "work management"
 * signals the dashboard needs (urgency, next action, pending signer count).
 * There is intentionally **no** database, Prisma, NestJS DI, or HTTP here — the
 * only outside dependency is the `@repo/db` enum *types*. `now` is always passed
 * in so time-dependent behaviour stays deterministic and testable.
 *
 * No schema change is required for the MVP: everything is derived at read time.
 */

// --- adjustable thresholds --------------------------------------------------

/**
 * An IN_PROGRESS contract whose `sentAt` is at least this many days ago (but not
 * yet OVERDUE) is DUE_SOON. Inclusive lower bound.
 */
export const DUE_SOON_DAYS = 5;

/**
 * An IN_PROGRESS contract whose `sentAt` is strictly more than this many days
 * ago is OVERDUE. The DUE_SOON window is [DUE_SOON_DAYS, OVERDUE_DAYS] days.
 */
export const OVERDUE_DAYS = 7;

/** Milliseconds in one day — used to convert an elapsed span into whole days. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// --- vocabulary -------------------------------------------------------------

/**
 * How much attention a contract needs *today*. Only IN_PROGRESS contracts can be
 * time-pressured; every other status (DRAFT, COMPLETED, CANCELLED) is NORMAL.
 */
export enum Urgency {
  OVERDUE = 'OVERDUE',
  DUE_SOON = 'DUE_SOON',
  NORMAL = 'NORMAL',
}

/**
 * The single next thing the owner can do with a contract, keyed off its status.
 * CANCELLED contracts have no actionable next step, so `nextAction` is `null`
 * (the defined fallback) rather than an invented enum member.
 */
export enum NextAction {
  SEND_DRAFT = 'SEND_DRAFT',
  AWAITING_SIGN = 'AWAITING_SIGN',
  DOWNLOAD = 'DOWNLOAD',
}

// --- derivations ------------------------------------------------------------

/**
 * Whole days elapsed between `sentAt` and `now`, floored. Negative spans (a
 * `sentAt` in the future, e.g. clock skew) floor toward 0 elapsed days so they
 * never read as urgent.
 */
function daysSince(sentAt: Date, now: Date): number {
  const elapsedMs = now.getTime() - sentAt.getTime();
  if (elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / MS_PER_DAY);
}

/**
 * Derive urgency from status + how long ago the contract was sent.
 *
 * Only IN_PROGRESS contracts with a `sentAt` are time-pressured:
 *   - elapsed > OVERDUE_DAYS (7)            → OVERDUE
 *   - DUE_SOON_DAYS (5) ≤ elapsed ≤ 7       → DUE_SOON
 *   - elapsed < 5                           → NORMAL
 * Every other status (DRAFT, COMPLETED, CANCELLED) or a missing `sentAt` is
 * NORMAL — there is nothing overdue about a draft or a finished contract.
 */
export function deriveUrgency(
  status: DocumentStatus,
  sentAt: Date | null,
  now: Date,
): Urgency {
  if (status !== DocumentStatus.IN_PROGRESS || sentAt === null) {
    return Urgency.NORMAL;
  }

  const days = daysSince(sentAt, now);
  if (days > OVERDUE_DAYS) return Urgency.OVERDUE;
  if (days >= DUE_SOON_DAYS) return Urgency.DUE_SOON;
  return Urgency.NORMAL;
}

/**
 * Derive the owner's next action purely from status:
 *   DRAFT       → SEND_DRAFT     (not sent yet)
 *   IN_PROGRESS → AWAITING_SIGN  (out for signature)
 *   COMPLETED   → DOWNLOAD       (grab the signed artifacts)
 *   CANCELLED   → null           (no actionable next step)
 */
export function deriveNextAction(status: DocumentStatus): NextAction | null {
  switch (status) {
    case DocumentStatus.DRAFT:
      return NextAction.SEND_DRAFT;
    case DocumentStatus.IN_PROGRESS:
      return NextAction.AWAITING_SIGN;
    case DocumentStatus.COMPLETED:
      return NextAction.DOWNLOAD;
    case DocumentStatus.CANCELLED:
      return null;
    default:
      return null;
  }
}

/**
 * Count signers still being waited on. A signer is "pending" while their request
 * is PENDING (not yet opened) or VIEWED (opened, not yet signed). SIGNED and
 * DECLINED are resolved outcomes and are not counted.
 */
export function countPendingSigners(
  signRequestStatuses: readonly SignRequestStatus[],
): number {
  return signRequestStatuses.filter(
    (s) =>
      s === SignRequestStatus.PENDING || s === SignRequestStatus.VIEWED,
  ).length;
}
