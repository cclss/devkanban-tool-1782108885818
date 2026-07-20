/**
 * Auto-placement orchestration + the candidate→draft adapter (B안).
 *
 * Two responsibilities, kept apart by their nature:
 *
 *   • {@link autoPlaceFields} — the I/O chain that turns a user's PDF File into
 *     typed field candidates: open the document, extract each page's phrases,
 *     then run the rule-based anchor matcher. It owns the pdfjs handle's lifetime
 *     (destroy on the way out) and delegates every pure step to the modules that
 *     already implement it — no re-implementation of PDF text or anchor logic.
 *   • {@link candidatesToSuggestions} — the pure adapter that reshapes those
 *     candidates into the wizard's draft field shape, dropping any that would
 *     duplicate a field the user has *already* placed. This is the bridge from
 *     "recommendation" to "the same field object the manual flow produces".
 *
 * The adapter emits `Omit<SignFieldDraft, 'id'>` — the persisted draft minus the
 * two things this grain is explicitly not responsible for: the field `id`
 * (assigned when a suggestion is accepted) and `recipientIndex` (recipient
 * attribution happens later in the flow). Geometry is a straight spread of the
 * candidate's `NormRect` (0..1 bottom-left), the exact coordinate contract the
 * manual placement path and the server already share — so an accepted suggestion
 * saves through the existing store flow unchanged.
 *
 * `SignFieldDraft`/`SignFieldType` are reused from the wizard context and
 * `NormRect` from `field-geometry`; `FieldCandidate`/`phrasesToFieldCandidates`
 * from `field-anchors`; `extractPagePhrases` from `pdf-text`; `openPdf` from
 * `pdf`. Nothing here touches the DOM.
 */

import type { SignFieldDraft } from '@/components/wizard/wizard-context';
import type { NormRect } from './field-geometry';
import { phrasesToFieldCandidates, type FieldCandidate } from './field-anchors';
import { extractPagePhrases } from './pdf-text';
import { openPdf } from './pdf';

/**
 * A recommended draft field, ready to be accepted into the wizard's field list.
 * It is exactly a persisted draft minus `id` (assigned on accept) and, by
 * omission, `recipientIndex` (recipient attribution is a later step).
 */
export type FieldSuggestion = Omit<SignFieldDraft, 'id'>;

/**
 * How close two same-type boxes on the same page must be, per axis (normalized
 * 0..1, center-to-center), to count as the same field. Compared against each
 * axis independently so a suggestion is suppressed only when it lands squarely
 * on top of an existing field — not merely in the same neighborhood.
 */
const DEDUP_PROXIMITY = 0.05;

/** Center point of a normalized rect. */
function center(rect: NormRect): { cx: number; cy: number } {
  return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2 };
}

/** Whether two boxes' centers sit within {@link DEDUP_PROXIMITY} on both axes. */
function isNearDuplicate(a: NormRect, b: NormRect): boolean {
  const ca = center(a);
  const cb = center(b);
  return (
    Math.abs(ca.cx - cb.cx) <= DEDUP_PROXIMITY &&
    Math.abs(ca.cy - cb.cy) <= DEDUP_PROXIMITY
  );
}

/**
 * Reshape anchor candidates into draft suggestions, dropping any that would
 * duplicate an existing confirmed field.
 *
 * Pure and order-preserving. A candidate is a duplicate — and skipped — when an
 * existing field shares its page and type and sits near the same spot
 * ({@link isNearDuplicate}); this keeps auto-placement from re-recommending a
 * field the user already put down. Survivors are emitted with the candidate's
 * `NormRect` spread into `x`/`y`/`width`/`height`, no `id`, and no
 * `recipientIndex`.
 */
export function candidatesToSuggestions(
  candidates: readonly FieldCandidate[],
  existingFields: readonly SignFieldDraft[],
): FieldSuggestion[] {
  const suggestions: FieldSuggestion[] = [];
  for (const candidate of candidates) {
    const duplicate = existingFields.some(
      (field) =>
        field.page === candidate.page &&
        field.type === candidate.type &&
        isNearDuplicate(candidate.rect, {
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
        }),
    );
    if (duplicate) continue;
    suggestions.push({
      type: candidate.type,
      page: candidate.page,
      x: candidate.rect.x,
      y: candidate.rect.y,
      width: candidate.rect.width,
      height: candidate.rect.height,
    });
  }
  return suggestions;
}

/**
 * Open a PDF File and return its rule-detected field candidates.
 *
 * The I/O half of auto-placement: `openPdf` → `extractPagePhrases` →
 * `phrasesToFieldCandidates`. Owns the pdfjs document's lifetime, destroying it
 * (worker-side resources) before returning regardless of outcome. All matching
 * and placement is delegated to the pure modules — this only wires the chain.
 */
export async function autoPlaceFields(file: File): Promise<FieldCandidate[]> {
  const { doc } = await openPdf(file);
  try {
    const pages = await extractPagePhrases(doc);
    return phrasesToFieldCandidates(pages);
  } finally {
    void doc.destroy();
  }
}
