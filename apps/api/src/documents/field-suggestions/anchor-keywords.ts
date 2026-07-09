/**
 * Anchor keyword configuration for the text-heuristic field-suggestion engine.
 *
 * This is the **single tuning surface** for which text fragments in a PDF's text
 * layer count as an anchor for each field type. The matcher (grain-2/3) reads
 * this config and nothing else, so keyword coverage can be iterated here without
 * touching engine logic or spreading string literals across the codebase.
 *
 * Matching semantics the engine is expected to apply (kept out of this data so
 * the config stays a plain, reviewable list):
 *   • case-insensitive — Latin keywords are listed lower-case; the matcher
 *     lower-cases the compared text fragment;
 *   • substring/contains against a normalized (whitespace-collapsed) fragment —
 *     `년 월 일` should still match `년   월   일`.
 *
 * Field types come from `@repo/field-geometry` so the keyed set can never drift
 * from the coordinate/geometry contract that produces the field boxes.
 *
 * Note: `성명` intentionally anchors both SIGNATURE (name-as-signature blocks)
 * and TEXT (a plain name field) — the engine disambiguates by surrounding
 * layout, not by keyword uniqueness.
 */

import type { SignFieldType } from '@repo/field-geometry';

/** Per-field-type anchor keyword sets. Edit here to tune heuristic coverage. */
export const ANCHOR_KEYWORDS: Record<SignFieldType, readonly string[]> = {
  SIGNATURE: ['서명', '(인)', '서명란', '성명', 'signature'],
  DATE: ['날짜', '서명일', '작성일', '년 월 일', 'date'],
  TEXT: ['이름', '성명', '주소', '연락처'],
};
