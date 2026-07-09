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
import { nextFieldId } from './field-id';
import type { DocumentSummary } from './documents';
import type { RecipientDraft, SignFieldDraft } from '@/components/wizard/wizard-context';

/**
 * A suggested field as returned by `POST /documents/:id/field-suggestions`.
 *
 * By contract this is the *same* shape as the saved field DTO (`SignFieldDto` on
 * the server): normalized `0..1` geometry, PDF bottom-left origin, `recipientIndex`
 * always `0` (single signer). The "suggestion" origin is not carried in the wire
 * data — it's stamped on locally as `source: 'auto'` so the canvas can style it.
 */
interface SuggestedFieldDto {
  type: SignFieldDraft['type'];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex?: number;
}

interface SignFieldPayload {
  type: SignFieldDraft['type'];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
}

interface RecipientPayload {
  email: string;
  name?: string;
  order: number;
}

/** Persist the draft's sign fields (replaces any previously saved set). */
export function saveFields(
  documentId: string,
  fields: SignFieldDraft[],
  token?: string,
): Promise<{ count: number }> {
  // Map field-by-field (never spread `f`) so client-only markers — notably the
  // AI-suggestion `source` flag — are dropped here and the server keeps seeing an
  // unchanged `SignFieldDto`. The persisted contract must not learn about drafts.
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
 * Ask the server for AI-drafted field placements and map them into ready-to-render
 * wizard drafts.
 *
 * The endpoint is best-effort help, not a gate: it returns a `SignFieldDto[]` of
 * suggestions or an empty array when it can't place anything (scanned PDF, no
 * anchor keywords, unreadable file — the server swallows those into `[]`). We pass
 * that distinction straight through:
 *
 *   • `[]`      → "nothing to suggest" — the caller falls back to manual placement.
 *   • *throws*  → a transport/ownership failure (`ApiError` from `apiFetch`); the
 *                 caller can surface an error instead of silently showing no fields.
 *
 * Each suggestion is turned into a `SignFieldDraft`: a fresh shared-counter id, the
 * normalized geometry preserved verbatim, `recipientIndex` defaulted to the single
 * signer, and `source: 'auto'` so the canvas renders it as a suggestion. These are
 * drafts only — the server persists nothing here; saving is still `saveFields`.
 */
export async function fetchFieldSuggestions(
  documentId: string,
  token?: string,
): Promise<SignFieldDraft[]> {
  const suggestions = await apiFetch<SuggestedFieldDto[]>(
    `/documents/${documentId}/field-suggestions`,
    { method: 'POST', token },
  );
  return suggestions.map((f) => ({
    id: nextFieldId(),
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    recipientIndex: f.recipientIndex ?? 0,
    source: 'auto',
  }));
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
