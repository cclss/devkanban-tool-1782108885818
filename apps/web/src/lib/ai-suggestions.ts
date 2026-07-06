/**
 * AI auto-field-placement — the editor's ingress for AI-proposed fields.
 *
 * The tiered analysis (grain-2~4) runs server-side on upload and produces field
 * *candidates* in the same normalized, page-relative shape the editor stores
 * (`SignFieldDraft`). This module is the thin client seam that pulls those
 * candidates and adapts them into editor fields tagged `source: 'ai'`, so the
 * placement canvas can render them with the AI-suggestion visual language and
 * the sender can review / edit / clear them.
 *
 * Boundary (grain-6): this is the *frontend* seam only. It targets the document's
 * field-suggestions endpoint and degrades gracefully to "no suggestions" on any
 * error — so while the server pipeline's text extractor / page renderer are still
 * unbound (the whole feature is dark end-to-end, like grains 2–4), the editor
 * simply opens blank instead of failing. When a later grain lights up the server
 * path, the same seam surfaces real suggestions with no editor change.
 */

import { apiFetch } from './api';
import { clampNormRect, FIELD_TYPES, type SignFieldType } from './field-geometry';
import { nextFieldId } from './field-id';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

/**
 * A single AI-proposed field, mirroring the server's `FieldCandidate` geometry
 * (`apps/api/src/field-detection/field-detection.types.ts`): normalized 0..1,
 * bottom-left origin — identical to `SignFieldDraft`, so no coordinate
 * translation is needed. Confidence / anchor metadata is intentionally omitted;
 * the editor treats every returned candidate as an equal, fully-editable
 * suggestion (the grain does not expose per-suggestion confidence to the user).
 */
export interface AiFieldSuggestion {
  type: SignFieldType;
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Server response for the field-suggestions read seam. */
interface FieldSuggestionsResponse {
  fields?: unknown;
}

function isFieldType(value: unknown): value is SignFieldType {
  return typeof value === 'string' && (FIELD_TYPES as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate one raw candidate from the wire. AI output is untrusted input, so a
 * malformed entry is dropped rather than rendered as a broken box.
 */
function parseSuggestion(raw: unknown): AiFieldSuggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (!isFieldType(c.type)) return null;
  if (
    !isFiniteNumber(c.page) ||
    !isFiniteNumber(c.x) ||
    !isFiniteNumber(c.y) ||
    !isFiniteNumber(c.width) ||
    !isFiniteNumber(c.height)
  ) {
    return null;
  }
  return {
    type: c.type,
    page: Math.max(1, Math.trunc(c.page)),
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
  };
}

/**
 * Adapt AI candidates into editor fields. Each becomes a `source: 'ai'`
 * `SignFieldDraft` with a fresh id and a clamped-in-page box, so a suggestion is
 * a first-class field the sender can move / resize / delete like any other.
 */
export function toAiFieldDrafts(suggestions: AiFieldSuggestion[]): SignFieldDraft[] {
  return suggestions.map((s) => {
    const norm = clampNormRect({ x: s.x, y: s.y, width: s.width, height: s.height });
    return {
      id: nextFieldId(),
      type: s.type,
      page: s.page,
      source: 'ai',
      ...norm,
    };
  });
}

/** How many of these fields are AI suggestions. */
export function countAiSuggestions(fields: SignFieldDraft[]): number {
  return fields.reduce((n, f) => (f.source === 'ai' ? n + 1 : n), 0);
}

/**
 * Replace the AI-suggestion batch on the canvas: any manual fields the sender
 * placed are kept, a previous batch of suggestions is dropped (so re-seeding
 * never duplicates), and the fresh suggestions are appended.
 */
export function withAiSuggestions(
  fields: SignFieldDraft[],
  suggestions: SignFieldDraft[],
): SignFieldDraft[] {
  return [...withoutAiSuggestions(fields), ...suggestions];
}

/** Drop every AI suggestion, leaving only the sender's manual fields. */
export function withoutAiSuggestions(fields: SignFieldDraft[]): SignFieldDraft[] {
  return fields.filter((f) => f.source !== 'ai');
}

/**
 * Fetch the AI field suggestions for a document, already adapted to editor
 * fields. Never throws: a missing endpoint, an auth lapse, a transport error, or
 * a malformed body all resolve to an empty list, so the editor treats "couldn't
 * get suggestions" the same as "AI found nothing" — the sender simply places
 * fields by hand.
 */
export async function fetchAiFieldDrafts(
  documentId: string,
  token?: string,
): Promise<SignFieldDraft[]> {
  try {
    const res = await apiFetch<FieldSuggestionsResponse>(
      `/documents/${encodeURIComponent(documentId)}/field-suggestions`,
      { token },
    );
    const raw = Array.isArray(res?.fields) ? res.fields : [];
    const parsed = raw.map(parseSuggestion).filter((s): s is AiFieldSuggestion => s !== null);
    return toAiFieldDrafts(parsed);
  } catch {
    return [];
  }
}
