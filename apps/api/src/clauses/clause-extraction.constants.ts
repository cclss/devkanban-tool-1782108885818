import type { ClauseExtractionStatus } from '@repo/db';

/**
 * Shared identifiers for the send-time clause-extraction pipeline (grain-4).
 *
 * When a contract is dispatched, `DocumentsService.send()` enqueues a
 * `document-clause-extract` job onto this BullMQ queue (jobId = documentId, so a
 * document is never queued twice concurrently). A co-located worker runs the
 * pipeline (read PDF → extract text → structure clauses → persist cards + record
 * `Document.clauseStatus`). When REDIS_URL is unset the queue degrades to an
 * inline run so pre-generation still happens end-to-end locally.
 */

/** BullMQ queue name for send-time clause extraction jobs. */
export const CLAUSE_EXTRACTION_QUEUE = 'document-clause-extraction';

/** Job name within the queue. */
export const CLAUSE_EXTRACTION_JOB = 'document-clause-extract';

/** Payload carried by a clause-extraction job. */
export interface ClauseExtractionJobData {
  /** The document to pre-generate clause cards for. */
  documentId: string;
}

/** Outcome of one extraction run (mostly for tests / logging). */
export interface ClauseExtractionResult {
  documentId: string;
  /** True when the pipeline actually resolved the document (not skipped). */
  processed: boolean;
  /** True when the run was a no-op (document not found). */
  skipped: boolean;
  /** Terminal clause status recorded on the document (when processed). */
  status?: ClauseExtractionStatus;
  /** Number of clause cards persisted (0 for EMPTY/FAILED). */
  cardCount?: number;
}
