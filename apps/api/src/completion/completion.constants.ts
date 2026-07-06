/**
 * Shared identifiers for the completion post-processing pipeline (grain-5).
 *
 * When the last signer finishes, `signing.service.complete()` enqueues a
 * `document-completed` job onto this BullMQ queue. A consumer worker runs the
 * full pipeline (final PDF → certificate → storage → email → record). When
 * REDIS_URL is unset the queue degrades to an inline run so the flow still
 * completes end-to-end locally.
 */

/** BullMQ queue name for completion post-processing jobs. */
export const COMPLETION_QUEUE = 'document-completion';

/** Job name within the queue. */
export const COMPLETION_JOB = 'document-completed';

/** Payload carried by a completion job. */
export interface CompletionJobData {
  /** The document whose last signer just completed. */
  documentId: string;
}

/** Outcome of one post-processing run (mostly for tests / logging). */
export interface CompletionResult {
  documentId: string;
  /** True when this run actually produced the artifacts. */
  processed: boolean;
  /** True when the run was a no-op because the document was already processed. */
  skipped: boolean;
  /** Object key of the stored signed final PDF (when processed). */
  signedStorageKey?: string;
  /** Object key of the stored audit certificate PDF (when processed). */
  certificateStorageKey?: string;
  /** Number of completion emails dispatched (sender + signers). */
  recipientCount?: number;
}
