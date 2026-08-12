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
import { buildSendBody } from './send-plan';
import type { RecipientDraft, SignFieldDraft } from '@/components/wizard/wizard-context';

interface SignFieldPayload {
  type: SignFieldDraft['type'];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
}

/** Persist the draft's sign fields (replaces any previously saved set). */
export function saveFields(
  documentId: string,
  fields: SignFieldDraft[],
  token?: string,
): Promise<{ count: number }> {
  const payload: SignFieldPayload[] = fields.map((f) => ({
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    // Every field is homed onto a recipient by the recipients step's
    // autoAssignFields invariant; default to the first signer just in case.
    recipientIndex: f.recipientIndex ?? 0,
  }));
  return apiFetch<{ count: number }>(`/documents/${documentId}/fields`, {
    method: 'PUT',
    json: { fields: payload },
    token,
  });
}

/**
 * Dispatch the contract. Body assembly (recipient signing order + the optional
 * `scheduledSendAt`) lives in the pure `buildSendBody` so both forks are unit-
 * tested without the network.
 *
 * When `scheduledSendAt` (a future UTC ISO string) is supplied the server parks
 * the document as 예약됨 and registers a delayed job instead of dispatching now;
 * omit it and the immediate-send path is unchanged. The server enforces the
 * future/format rule and surfaces its Korean rejection copy verbatim.
 */
export function sendContract(
  documentId: string,
  recipients: RecipientDraft[],
  token?: string,
  scheduledSendAt?: string,
): Promise<DocumentSummary> {
  return apiFetch<DocumentSummary>(`/documents/${documentId}/send`, {
    method: 'POST',
    json: buildSendBody(recipients, scheduledSendAt),
    token,
  });
}
