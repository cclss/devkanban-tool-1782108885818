/**
 * Client-side id generator for placed sign fields.
 *
 * A single monotonic counter is shared by *every* source that mints a field id —
 * the placement canvas (drop / keyboard add) and the AI auto-placement mapping
 * (`lib/send.ts` `fetchFieldSuggestions`) — so ids never collide across sources.
 * Kept in a tiny, DOM-free module (no React / pdf imports) so the data layer can
 * reuse it without dragging the canvas component into its bundle.
 */

let fieldSeq = 0;

/** Monotonic, collision-resistant id for a newly placed (or suggested) field. */
export function nextFieldId(): string {
  fieldSeq += 1;
  return `field-${fieldSeq}-${Math.round(performance.now())}`;
}
