/**
 * Shared identifiers + contracts for the scheduled-send delayed-job pipeline
 * (grain-2).
 *
 * When a sender defers a dispatch, the endpoint (grain-3) sets the document to
 * SCHEDULED and calls `ScheduledSendQueue.schedule(...)`, which enqueues a
 * BullMQ job with a `delay`. When the delay elapses a co-located worker fires
 * and hands the job back to the documents layer, which reuses the grain-1
 * dispatch core (`DocumentsService.dispatchContract`) to actually send.
 *
 * Mirrors the completion pipeline conventions (`completion.constants.ts`):
 * a stable queue name + job name and a typed payload. When REDIS_URL is unset
 * the queue degrades to an in-memory timer so local dev still auto-sends.
 */

/** BullMQ queue name for scheduled-send delayed jobs. */
export const SCHEDULED_SEND_QUEUE = 'document-scheduled-send';

/** Job name within the queue. */
export const SCHEDULED_SEND_JOB = 'document-scheduled-send';

/**
 * A recipient carried by a scheduled-send job. Deliberately the exact shape
 * `DocumentsService.dispatchContract` consumes, so the fired worker can dispatch
 * without re-deriving anything: the endpoint normalizes the DTO recipients once,
 * at schedule time, and the normalized list travels with the job (persisted in
 * Redis, so it survives an API restart).
 */
export interface ScheduledSendRecipient {
  email: string;
  name: string | null;
  order: number;
  index: number;
}

/** Payload carried by a scheduled-send job. */
export interface ScheduledSendJobData {
  /** The document to auto-send when the delay elapses. */
  documentId: string;
  /** Owner (sender) id — audit actor + quota subject for the deferred dispatch. */
  ownerId: string;
  /** Normalized recipient list to dispatch to (see `ScheduledSendRecipient`). */
  recipients: ScheduledSendRecipient[];
  /** Origin IP captured at schedule time, threaded into the audit trail. */
  ip?: string;
}

/**
 * DI token for the object the fired worker calls back into. Bound to
 * `DocumentsService` via `useExisting` in `DocumentsModule`; resolved lazily
 * (through `ModuleRef`) inside the worker so the queue never takes a
 * constructor-time dependency on `DocumentsService` — that would form a cycle
 * (`DocumentsService` needs the queue to schedule/cancel).
 */
export const SCHEDULED_SEND_DISPATCHER = Symbol('SCHEDULED_SEND_DISPATCHER');

/**
 * The callback surface the scheduled-send worker uses. Implemented by
 * `DocumentsService`:
 *   • `dispatchScheduled` — auto-send the document (reuses `dispatchContract`).
 *   • `notifyScheduledSendFailure` — alert the sender when a deferred send fails
 *     for good (retries exhausted / inline fallback error).
 */
export interface ScheduledSendDispatcher {
  dispatchScheduled(data: ScheduledSendJobData): Promise<void>;
  notifyScheduledSendFailure(documentId: string, reason: string): Promise<void>;
}
