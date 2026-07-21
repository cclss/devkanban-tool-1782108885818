/**
 * Completion recap selection — which key-clause cards resurface on the finish
 * screen, and in what order.
 *
 * The pre-read summary (grain-6) shows every extracted clause in the server's
 * order so the signer can grasp the whole contract before signing. The
 * completion recap (grain-9) has a different job: it's a *reminder* after the
 * fact, in a narrow celebratory column. So we surface the `caution` clauses
 * first ("here's what to keep in mind"), keep the rest in their original order,
 * and cap the list so the finish screen stays glanceable rather than becoming a
 * second full read.
 *
 * Pure + DOM-free on purpose (jest `node` env): the completion screen imports
 * this to pick what to render; all visual/token concerns live in the component.
 */

import type { ContractHighlight } from './signing';

/** Default recap cap — enough to remember the contract, few enough to glance. */
export const COMPLETION_SUMMARY_LIMIT = 4;

/**
 * Pick + order the clauses shown on the completion recap.
 *
 * - `caution` clauses come first (stable within the group), then the rest in
 *   their original server order (also stable) — a stable partition, so equal
 *   items never reshuffle between renders.
 * - The result is capped at `limit` (default {@link COMPLETION_SUMMARY_LIMIT}).
 * - A non-positive `limit` yields an empty list; a limit larger than the input
 *   simply returns everything (caution-first).
 *
 * Never mutates the input array.
 */
export function selectCompletionSummary(
  clauses: readonly ContractHighlight[],
  limit: number = COMPLETION_SUMMARY_LIMIT,
): ContractHighlight[] {
  if (limit <= 0) return [];
  const cautions = clauses.filter((c) => c.tone === 'caution');
  const rest = clauses.filter((c) => c.tone !== 'caution');
  return [...cautions, ...rest].slice(0, limit);
}
