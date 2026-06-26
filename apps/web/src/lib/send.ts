/**
 * Contract dispatch — persist the placed fields, then send the contract.
 *
 * The wizard keeps fields/recipients in local state across steps; the server's
 * send endpoint (`POST /documents/:id/send`) only takes recipients and reads the
 * *already-saved* fields from the DB to map them to signers. So sending is two
 * authenticated calls in order:
 *
 *   1. PUT  /documents/:id/fields  — replace the draft's sign fields (SaveFieldsDto)
 *   2. POST /documents/:id/send    — create one SignRequest per recipient, flip
 *                                    the document to 진행 중 (SendContractDto)
 *
 * Both go through `apiFetch`, so the server's Korean error copy surfaces verbatim
 * (quota, already-sent, no-fields…) and transport failures fall back to the
 * neutral generic line. See `apps/api/src/documents/documents.controller.ts`.
 */

import { apiFetch } from './api';
import type { DocumentSummary } from './documents';
import type { RecipientDraft, SignFieldDraft } from '@/components/wizard/wizard-context';

interface SignFieldPayload {
  type: SignFieldDraft['type'];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
  /** Provenance the server persists with the confirmed field. */
  source: 'AI' | 'MANUAL';
  /** Confidence (0..1) sent only for an unadjusted AI field. */
  confidence?: number;
}

/** Result of persisting fields: how many, and the resulting send-readiness. */
export interface SaveFieldsResult {
  count: number;
  /** Server document status after the save (e.g. 'READY' once confirmed). */
  status: string;
  /** Server-authored Korean status label (single source of truth). */
  statusLabel: string;
  /** True once fields are confirmed/persisted and the contract awaits send. */
  readyToSend: boolean;
}

interface RecipientPayload {
  email: string;
  name?: string;
  order: number;
}

/**
 * Persist the draft's sign fields (replaces any previously saved set) and their
 * provenance. Saving ≥1 field confirms the placement: the server marks the
 * document "발송 준비 완료" (READY) while keeping send a separate action.
 */
export function saveFields(
  documentId: string,
  fields: SignFieldDraft[],
  token?: string,
): Promise<SaveFieldsResult> {
  const payload: SignFieldPayload[] = fields.map((f) => {
    const isAi = f.source === 'ai';
    return {
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      // Every field is homed onto a recipient by the recipients step's
      // autoAssignFields invariant; default to the first signer just in case.
      recipientIndex: f.recipientIndex ?? 0,
      // Default to MANUAL: a hand-placed field (no source) or one the user
      // adjusted is the sender's own placement. Confidence rides along only for
      // an untouched AI suggestion (and the server drops it for MANUAL anyway).
      source: isAi ? 'AI' : 'MANUAL',
      ...(isAi && f.confidence !== undefined ? { confidence: f.confidence } : {}),
    };
  });
  return apiFetch<SaveFieldsResult>(`/documents/${documentId}/fields`, {
    method: 'PUT',
    json: { fields: payload },
    token,
  });
}

/**
 * Dispatch the contract. Recipient array order *is* the signing order, so we
 * stamp an explicit `order` from the index (the backend also derives it, but
 * being explicit keeps the contract obvious). A blank name is omitted (optional
 * server-side) rather than sent as an empty string.
 */
export function sendContract(
  documentId: string,
  recipients: RecipientDraft[],
  token?: string,
): Promise<DocumentSummary> {
  const payload: RecipientPayload[] = recipients.map((r, i) => {
    const name = r.name.trim();
    return {
      email: r.email.trim(),
      ...(name ? { name } : {}),
      order: i,
    };
  });
  return apiFetch<DocumentSummary>(`/documents/${documentId}/send`, {
    method: 'POST',
    json: { recipients: payload },
    token,
  });
}
