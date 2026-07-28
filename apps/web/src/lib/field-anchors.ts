/**
 * Rule-based anchor dictionary + field placement (no LLM).
 *
 * Given the phrases extracted from a text PDF ({@link PagePhrases} from
 * `pdf-text.ts`), this module decides — purely from a keyword dictionary and
 * deterministic geometry — which phrases look like a *signature*, *date*,
 * *name*, or *amount* label, and where a matching sign-field should be
 * suggested next to that label.
 *
 * Two-stage design (see design-spec `spec-anchor-dictionary-placement.md`):
 *   1. Classify — {@link matchAnchor} normalizes a phrase's text and tests it
 *      against {@link ANCHOR_DICT}. A phrase resolves to at most ONE
 *      {@link AnchorCategory} (highest-weight keyword wins; ties broken by a
 *      fixed category priority, so the result is deterministic).
 *   2. Place — {@link placeRect} puts a default-sized field box beside the
 *      anchor's `rect`: to its right on the same line when there's room, else
 *      just below it. Every candidate rect is passed through `clampNormRect`,
 *      so it is always a valid in-page NormRect.
 *
 * Coordinate reuse: anchors and candidates all live in the *same* normalized
 * PDF space as the stored field model (`NormRect`: bottom-left origin, +y up,
 * 0..1). No new coordinate system is introduced — `FIELD_TYPE_META` supplies
 * the default field footprint and `clampNormRect` the boundary validation, both
 * from `field-geometry.ts`.
 *
 * Purity: no DOM, no pdfjs. Every export is a pure function over plain data, so
 * the classify+place rules unit-test without a browser or a real PDF.
 *
 * The 4 anchor categories map onto the 3 persisted field types (name and amount
 * both become TEXT); the storage contract (`SignFieldDto`:
 * SIGNATURE|DATE|TEXT) is unchanged.
 */

import {
  FIELD_TYPE_META,
  clampNormRect,
  type NormRect,
  type SignFieldType,
} from './field-geometry';
import type { PagePhrases, Phrase } from './pdf-text';

/**
 * Internal classification label for an anchor phrase. Four kinds are detected;
 * this label never reaches the stored field (it collapses to a
 * {@link SignFieldType} via {@link CATEGORY_TO_FIELD_TYPE}). Kept on the
 * candidate for diagnostics / grouping in the recommendation UI.
 */
export type AnchorCategory = 'SIGN' | 'DATE' | 'NAME' | 'AMOUNT';

/**
 * Anchor category → persisted field type. Name and amount have no dedicated
 * field type, so they place a TEXT field (storage contract stays 3 types).
 */
export const CATEGORY_TO_FIELD_TYPE: Record<AnchorCategory, SignFieldType> = {
  SIGN: 'SIGNATURE',
  DATE: 'DATE',
  NAME: 'TEXT',
  AMOUNT: 'TEXT',
};

/**
 * Tie-break order when two categories match a phrase with equal weight. Earlier
 * = higher priority. Makes classification deterministic regardless of dictionary
 * iteration order.
 */
const CATEGORY_PRIORITY: readonly AnchorCategory[] = ['SIGN', 'DATE', 'NAME', 'AMOUNT'];

/**
 * A guard that can suppress an otherwise-matching keyword:
 *   • `needs-digit-or-strong` — weak money units (원 / ₩ / won) only count when
 *     the same phrase carries a digit or a strong amount keyword, so "지원서" /
 *     "병원" don't read as money.
 *   • `exact` — the term must equal the *whole* normalized phrase, not just be a
 *     substring. Used for the bare seal mark "(인)" → "인" so it doesn't fire on
 *     every word containing 인 ("확인", "본인", "신청인").
 */
type Guard = 'needs-digit-or-strong' | 'exact';

interface Keyword {
  /** Match term; compared after {@link normalize} is applied to both sides. */
  term: string;
  /** Higher = more specific/confident. Strong ≈ term length, weak = 1. */
  weight: number;
  guard?: Guard;
}

/**
 * The anchor dictionary. Terms are written in their human form and normalized
 * at module load ({@link buildDict}), so authoring stays readable while matching
 * runs on normalized text. Draft set — a human may extend it (see design-spec
 * §4.1); adding terms here does not change the API.
 */
const RAW_DICT: Record<AnchorCategory, Keyword[]> = {
  SIGN: [
    { term: '서명란', weight: 3 },
    { term: '서명', weight: 2 },
    { term: '사인', weight: 2 },
    { term: '날인', weight: 2 },
    { term: 'signature', weight: 9 },
    { term: 'sign', weight: 4 },
    { term: '인', weight: 1, guard: 'exact' },
  ],
  DATE: [
    { term: '작성일자', weight: 4 },
    { term: '작성일', weight: 3 },
    { term: '계약일', weight: 3 },
    { term: '일자', weight: 2 },
    { term: '날짜', weight: 2 },
    { term: 'date', weight: 4 },
    { term: '년 월 일', weight: 1 },
    { term: '년월일', weight: 1 },
    { term: 'yyyy', weight: 1 },
  ],
  NAME: [
    { term: '대표자', weight: 3 },
    { term: '신청인', weight: 3 },
    { term: '성명', weight: 2 },
    { term: '성함', weight: 2 },
    { term: '이름', weight: 2 },
    { term: 'name', weight: 4 },
    { term: '귀하', weight: 1 },
    { term: '님', weight: 1 },
  ],
  AMOUNT: [
    { term: '공급가액', weight: 4 },
    { term: '금액', weight: 2 },
    { term: '합계', weight: 2 },
    { term: '총액', weight: 2 },
    { term: 'amount', weight: 6 },
    { term: 'total', weight: 5 },
    { term: '원', weight: 1, guard: 'needs-digit-or-strong' },
    { term: '₩', weight: 1, guard: 'needs-digit-or-strong' },
    { term: 'won', weight: 1, guard: 'needs-digit-or-strong' },
  ],
};

/**
 * Normalize text for matching: NFKC (full-width → half-width, unify ₩ / ligatures),
 * lowercase (case-insensitive Latin), then collapse the separator characters
 * `: · . - _ ( )` and any whitespace runs into single spaces, trimmed. This folds
 * "SIGNATURE" / "signature" / " 서명 " / "서명:" onto the same key.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[:·.\-_()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface NormKeyword {
  term: string;
  weight: number;
  guard?: Guard;
}

const ANCHOR_DICT: Record<AnchorCategory, NormKeyword[]> = buildDict();

function buildDict(): Record<AnchorCategory, NormKeyword[]> {
  const out = {} as Record<AnchorCategory, NormKeyword[]>;
  for (const category of CATEGORY_PRIORITY) {
    out[category] = RAW_DICT[category]
      .map((k) => ({ term: normalize(k.term), weight: k.weight, guard: k.guard }))
      .filter((k) => k.term.length > 0);
  }
  return out;
}

/** True if `normText` contains any strong (unguarded) amount keyword. */
function hasStrongAmount(normText: string): boolean {
  return ANCHOR_DICT.AMOUNT.some((k) => !k.guard && normText.includes(k.term));
}

/** Whether a guarded keyword is allowed to match against `normText`. */
function guardSatisfied(guard: Guard, term: string, normText: string): boolean {
  if (guard === 'exact') return normText === term;
  // needs-digit-or-strong: a digit anywhere, or a strong amount keyword present.
  return /\d/.test(normText) || hasStrongAmount(normText);
}

/** Result of classifying one phrase, or `null` when nothing matched. */
export interface AnchorMatch {
  category: AnchorCategory;
  /** The (normalized) dictionary term that scored highest. */
  term: string;
  /** Winning weight = the strongest matched keyword for the chosen category. */
  score: number;
}

/**
 * Classify a phrase's text into at most one {@link AnchorCategory}.
 *
 * Scans every dictionary keyword against the normalized text; a category's score
 * is the max weight of its matching keywords. The highest-scoring category wins,
 * ties broken by {@link CATEGORY_PRIORITY}. Returns `null` when no keyword
 * matches (that phrase yields no candidate).
 */
export function matchAnchor(text: string): AnchorMatch | null {
  const norm = normalize(text);
  if (norm.length === 0) return null;

  let best: AnchorMatch | null = null;
  for (const category of CATEGORY_PRIORITY) {
    let bestWeight = 0;
    let bestTerm = '';
    for (const k of ANCHOR_DICT[category]) {
      const matches = k.guard === 'exact' ? norm === k.term : norm.includes(k.term);
      if (!matches) continue;
      if (k.guard && !guardSatisfied(k.guard, k.term, norm)) continue;
      if (k.weight > bestWeight) {
        bestWeight = k.weight;
        bestTerm = k.term;
      }
    }
    if (bestWeight === 0) continue;
    // Strictly-greater keeps the first category (higher priority) on ties.
    if (!best || bestWeight > best.score) {
      best = { category, term: bestTerm, score: bestWeight };
    }
  }
  return best;
}

// --- Placement settings (implementation values, not design tokens) ----------
// Changing these nudges where a *suggested* field lands relative to its label;
// they are not user-facing visual design values (coding.md §구현 설정값).

/** Normalized horizontal gap between an anchor's right edge and the field. */
const GAP_X = 0.01;
/** Normalized vertical gap between an anchor's bottom edge and a below-field. */
const GAP_Y = 0.01;

/** Where a candidate was placed relative to its anchor. */
export type Placement = 'right' | 'below';

/**
 * Position a default-sized field for `type` beside `anchor`.
 *
 * Right of the anchor on the same baseline when the field fits within the page
 * (`x + width ≤ 1`); otherwise below it (top edge under the anchor's bottom).
 * The result is always run through `clampNormRect`, so it is a valid in-page
 * box even if the below-placement would spill past the page bottom.
 */
export function placeRect(
  anchor: NormRect,
  type: SignFieldType,
): { rect: NormRect; placement: Placement } {
  const { width: w, height: h } = FIELD_TYPE_META[type].defaultSize;

  const rightX = anchor.x + anchor.width + GAP_X;
  if (rightX + w <= 1) {
    const rect = clampNormRect({
      x: rightX,
      y: anchor.y + anchor.height / 2 - h / 2,
      width: w,
      height: h,
    });
    return { rect, placement: 'right' };
  }

  const rect = clampNormRect({
    x: anchor.x,
    y: anchor.y - GAP_Y - h,
    width: w,
    height: h,
  });
  return { rect, placement: 'below' };
}

/**
 * A suggested field, derived from one matched anchor phrase. Recommendation
 * only — acceptance / edit / persistence is a later step.
 */
export interface FieldCandidate {
  /** Persisted field type to create. */
  type: SignFieldType;
  /** 1-based page the anchor (and thus the field) lives on. */
  page: number;
  /** Suggested field box — a valid in-page NormRect (clamped). */
  rect: NormRect;
  /** The anchor phrase's text (shown as the reason in the UI). */
  anchorText: string;
  /** Which anchor kind produced this (diagnostics / grouping). */
  category: AnchorCategory;
}

/** Classify + place a single phrase, or `null` if it isn't an anchor. */
function candidateForPhrase(phrase: Phrase): FieldCandidate | null {
  const match = matchAnchor(phrase.text);
  if (!match) return null;
  const type = CATEGORY_TO_FIELD_TYPE[match.category];
  const { rect } = placeRect(phrase.rect, type);
  return {
    type,
    page: phrase.page,
    rect,
    anchorText: phrase.text,
    category: match.category,
  };
}

/**
 * Turn extracted page phrases into suggested field candidates.
 *
 * Walks every page's phrases in order, keeps the ones that classify as an
 * anchor, and places a field beside each. Order is preserved (page ascending,
 * then phrase order) for determinism. A document with no anchor phrases (or an
 * empty input) yields `[]` — never throws — so a PDF without recognizable
 * labels simply produces no suggestions and manual placement carries on.
 */
export function suggestFields(pages: PagePhrases[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  for (const { phrases } of pages) {
    for (const phrase of phrases) {
      const candidate = candidateForPhrase(phrase);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}
