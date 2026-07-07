/**
 * Key-clause summary UI copy — the single source of truth for the *static*
 * strings the front-end renders around the AI summary (the AI disclaimer, the
 * "AI 요약" mark label, the caution "주의" label). These are chrome the UI owns,
 * NOT summary content: the generated `ClauseSummary` data carries no disclaimer
 * (design-spec/messaging/clause-card-copy.md — "고지는 데이터가 아니라 UI가 진다").
 *
 * Source of truth: design-spec/messaging/clause-card-copy.md, which extends the
 * project base voice (해요체, no blame, calm, gives the next action) and the AI
 * copy tone (AI as an assistant; control stays with the user; no internal engine
 * terms). Components take these strings from here and never own the wording,
 * mirroring `lib/todo-copy.ts` / `lib/settings-copy.ts`.
 */

export const CLAUSE_CARD_COPY = {
  /**
   * The disclaimer at the bottom of the card stack (the boundary into the
   * original document). States plainly that this is an AI summary and leaves
   * the next action — checking the original — with the signer. Deliberately
   * calm and bottom-placed (never a scary top banner).
   */
  disclaimer: 'AI가 요약한 내용이에요. 정확한 내용은 원문을 꼭 확인해 주세요.',
  /**
   * The short label paired with the sparkle glyph on the one-liner banner,
   * signaling "this summary is AI-assisted" once for the whole section. The
   * glyph itself is `aria-hidden`; this label carries the meaning.
   */
  aiMarkLabel: 'AI 요약',
  /**
   * The text label paired with the caution mark on a `caution` clause card, so
   * the "pay extra attention here" signal never rides on color/icon alone. A
   * calm nudge, not an alarm (base voice: no manufactured anxiety).
   */
  cautionLabel: '주의',
  /**
   * The "view in original" anchor on a clause card (`clause-card` Source anchor),
   * rendered only when the clause carries an in-range `sourcePage`. The visible
   * label states the signer's next action; the accessible label appends the page
   * so a screen reader hears where the jump lands. Action-oriented 해요체 chrome —
   * clicking opens the collapsed original and scrolls to that page.
   */
  viewSource: '원문에서 보기',
  viewSourceLabel: (page: number): string => `원문 ${page}페이지에서 보기`,
  /**
   * The full-width toggle at the summary→original boundary (below the clause
   * cards, above the CTA). Collapsed: invites opening the full original and
   * names its page count once known; expanded: folds it back. Action-oriented
   * 해요체 chrome around the summary — not clause content. The original is
   * collapsed by default so the summary reads first ("핵심을 먼저, 원문은 필요할 때").
   */
  originalToggleExpand: (pageCount: number): string =>
    pageCount > 0 ? `전체 원문 보기 ${pageCount}페이지` : '전체 원문 보기',
  originalToggleCollapse: '원문 접기',
} as const;
