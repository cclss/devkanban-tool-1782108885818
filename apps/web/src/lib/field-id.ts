/**
 * Monotonic, collision-resistant ids for newly placed sign fields.
 *
 * Lives in its own DOM-free module so both the placement canvas and the
 * AI-suggestion adapter can mint ids without pulling in the heavy PDF/React
 * canvas module (and so it stays unit-testable in the node test environment).
 */

let fieldSeq = 0;

/** A fresh field id, unique within a session. */
export function nextFieldId(): string {
  fieldSeq += 1;
  return `field-${fieldSeq}-${Math.round(performance.now())}`;
}
