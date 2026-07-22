/**
 * Template data access for the sender's reusable contract layouts.
 *
 * Thin wrappers over the authenticated `/templates` endpoints (see
 * `apps/api/src/templates/templates.controller.ts`). The type shapes mirror the
 * server's `TemplateSummary` / `TemplateDetail` DTOs
 * (`apps/api/src/templates/templates.service.ts`) so the wizard and the template
 * list bind to them directly.
 *
 * This grain covers only *saving* a template (from the wizard) and *listing*
 * the owner's templates. Every call goes through `apiFetch`, so the server's
 * Korean copy — quota reached ('저장할 수 있는 템플릿 수를 …'), not-found,
 * forbidden — surfaces verbatim, and transport failures fall back to the neutral
 * generic line.
 */

import { apiDownload, apiFetch } from './api';
import { getToken } from './auth';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

/**
 * A saved field placement inside a template. Geometry is normalized 0–1 relative
 * to its page; `recipientIndex` is the 0-based signer slot the field belongs to.
 * Mirrors the server's `TemplateField` JSON shape.
 */
export interface TemplateField {
  type: SignFieldDraft['type'];
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
}

/**
 * A template as it appears in the list view — no field layout. Mirrors the
 * server's `TemplateSummary` DTO.
 */
export interface TemplateSummary {
  id: string;
  name: string;
  pageCount: number;
  /** How many fields the saved layout holds (server-derived from `fields`). */
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single template incl. its full field layout, ready to load back into the
 * wizard. Mirrors the server's `TemplateDetail` DTO; returned by
 * {@link createTemplate}.
 */
export interface TemplateDetail extends TemplateSummary {
  /** Storage key of the template's source PDF (reused when sending). */
  storageKey: string;
  fields: TemplateField[];
}

/** JSON body for `POST /templates` (mirrors the server's `CreateTemplateDto`). */
interface CreateTemplatePayload {
  name: string;
  storageKey: string;
  pageCount?: number;
  fields: TemplateField[];
}

/** Inputs for {@link createTemplate}: the wizard's PDF + placed-field state. */
export interface CreateTemplateInput {
  name: string;
  /** Storage key of the already-uploaded source PDF. */
  storageKey: string;
  pageCount?: number;
  fields: SignFieldDraft[];
}

/**
 * Save the wizard's current PDF + field layout as a reusable template. Rejects
 * with the server's Toss-tone copy on failure (e.g. the plan's template limit is
 * reached) so the caller can surface it directly. Returns the created template
 * with its full layout.
 */
export function createTemplate(input: CreateTemplateInput): Promise<TemplateDetail> {
  const payload: CreateTemplatePayload = {
    name: input.name.trim(),
    storageKey: input.storageKey,
    ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
    fields: input.fields.map((f) => ({
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      // Every field is homed onto a recipient by the recipients step; default to
      // the first slot to match the server's own `recipientIndex ?? 0` coercion.
      recipientIndex: f.recipientIndex ?? 0,
    })),
  };
  return apiFetch<TemplateDetail>('/templates', {
    method: 'POST',
    json: payload,
    token: getToken() ?? undefined,
  });
}

/** List the signed-in owner's templates, newest first. */
export function listTemplates(): Promise<TemplateSummary[]> {
  return apiFetch<TemplateSummary[]>('/templates', { token: getToken() ?? undefined });
}

/**
 * Load a single template incl. its full field layout, ready to hydrate the
 * wizard. Rejects with the server's Korean copy (not-found / forbidden) on
 * failure. Mirrors `GET /templates/:id` (`TemplateDetail`).
 */
export function getTemplate(id: string): Promise<TemplateDetail> {
  return apiFetch<TemplateDetail>(`/templates/${encodeURIComponent(id)}`, {
    token: getToken() ?? undefined,
  });
}

/**
 * Rename a template — only its display name changes. The server trims the name
 * and re-validates length, then returns the updated detail. Rejects with the
 * server's Korean copy on failure. Mirrors `PATCH /templates/:id`.
 */
export function renameTemplate(id: string, name: string): Promise<TemplateDetail> {
  return apiFetch<TemplateDetail>(`/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: { name: name.trim() },
    token: getToken() ?? undefined,
  });
}

/**
 * Delete one of the owner's templates. Resolves once the server confirms
 * (`204 No Content`); rejects with the server's Korean copy on failure. Mirrors
 * `DELETE /templates/:id`.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch<void>(`/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token: getToken() ?? undefined,
  });
}

/**
 * Fetch the template's original PDF bytes as a `File`, so the wizard can reload
 * the source document exactly as an upload would. Streams from the new
 * `GET /templates/:id/file` endpoint; the server names the download via
 * `Content-Disposition` (falling back to `template.pdf`). Rejects with the
 * server's Korean copy on failure.
 */
export async function fetchTemplateFile(id: string): Promise<File> {
  const { blob, filename } = await apiDownload(`/templates/${encodeURIComponent(id)}/file`, {
    token: getToken() ?? undefined,
  });
  return new File([blob], filename ?? 'template.pdf', {
    type: blob.type || 'application/pdf',
  });
}
