/**
 * Confirm-step summary math (pure, DOM-free).
 *
 * grain-4 splits the wizard's last step into two explicit affordances —
 * "이대로 확정" (persist the confirmed fields → 발송 준비 완료) and a separate
 * "발송". The confirmation read-back needs three roll-ups of the placed fields:
 *
 *   • provenance — how the placement came to be: kept straight from the AI
 *     ("AI 제안 그대로", `source: 'ai'`) vs hand-placed or adjusted ("직접
 *     배치·조정", `source: 'manual'`/absent). This is the "AI 제안 → 사용자 확정"
 *     story grain-2 persists; here we only *count* it for the summary.
 *   • byType — per field type, in canonical order, zero-count types dropped.
 *   • byPage — per 1-based page, ascending, zero-count pages dropped.
 *
 * Kept out of the React module (same reason `signfield-suggestion.ts` is) so it
 * unit-tests in the node jest env.
 */

import { FIELD_TYPES, type SignFieldType } from './field-geometry';

/** The minimal field shape this summary reads. Mirrors `SignFieldDraft`. */
export interface SummarizableField {
  type: SignFieldType;
  /** 1-based page number. */
  page: number;
  /** `'ai'` = accepted straight from a suggestion; else hand-placed/adjusted. */
  source?: 'ai' | 'manual';
}

export interface TypeCount {
  type: SignFieldType;
  count: number;
}

export interface PageCount {
  /** 1-based page number. */
  page: number;
  count: number;
}

/**
 * Confirmed-field provenance split. `ai` = the AI's proposal accepted untouched;
 * `adjusted` = hand-placed or an AI suggestion the user moved/resized (its
 * `source` flips to `'manual'`). The two always sum to the field total.
 */
export interface ProvenanceSplit {
  ai: number;
  adjusted: number;
}

export interface FieldSummary {
  total: number;
  provenance: ProvenanceSplit;
  /** Per-type counts in canonical {@link FIELD_TYPES} order, zero-counts dropped. */
  byType: TypeCount[];
  /** Per-page counts ascending by page, zero-counts dropped. */
  byPage: PageCount[];
}

/**
 * Roll the placed fields up into the confirmation summary. Pure: deterministic
 * for a given input, no DOM/clock/storage. Order is stable (type = canonical,
 * page = ascending) so the read-back never reshuffles between renders.
 */
export function summarizeFields(fields: readonly SummarizableField[]): FieldSummary {
  const provenance: ProvenanceSplit = { ai: 0, adjusted: 0 };
  const typeAcc: Record<SignFieldType, number> = { SIGNATURE: 0, DATE: 0, TEXT: 0 };
  const pageAcc = new Map<number, number>();

  for (const f of fields) {
    if (f.source === 'ai') provenance.ai += 1;
    else provenance.adjusted += 1;
    typeAcc[f.type] += 1;
    pageAcc.set(f.page, (pageAcc.get(f.page) ?? 0) + 1);
  }

  const byType: TypeCount[] = FIELD_TYPES.filter((t) => typeAcc[t] > 0).map((t) => ({
    type: t,
    count: typeAcc[t],
  }));

  const byPage: PageCount[] = [...pageAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, count]) => ({ page, count }));

  return { total: fields.length, provenance, byType, byPage };
}
