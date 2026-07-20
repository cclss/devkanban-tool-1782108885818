/**
 * Rule-based anchor detection for auto-placing sign fields (B안, LLM-free).
 *
 * The auto-placement step reads a selectable-text PDF's extracted phrases (from
 * `pdf-text.ts`) and drops *draft* fields next to the labels a Korean contract
 * already prints — "서명", "날짜", "성명", "금액" and their variants. This module
 * is the matching + placement brain: given the phrases, decide which are anchors,
 * of which kind, and where the field box for each should go. It emits no visuals
 * and touches no DOM — it returns plain `NormRect` candidates in the *same*
 * bottom-left 0..1 coordinate system the persisted field model uses, so a caller
 * can hand them straight to the existing field pipeline as recommendations.
 *
 * Two moving parts, both pure and unit-tested against synthetic `PagePhrases`:
 *   • matching — normalize a phrase (lowercase, strip whitespace/brackets) and
 *     test it against a per-kind keyword dictionary. Multi-syllable keywords
 *     match as substrings ("서명란" ⊇ "서명"); single-syllable Korean anchors
 *     ("인", "원") match only as a whole phrase, because as substrings they fire
 *     on unrelated words ("확인", "지원") far too often.
 *   • placement — put the field to the anchor's right, dropping below when the
 *     right margin can't hold a default-sized box, then clamp into the page.
 *
 * Reuses `field-geometry.ts` for the coordinate shape (`NormRect`), the field
 * taxonomy (`SignFieldType`), per-type default sizes (`FIELD_TYPE_META`), and the
 * in-page clamp (`clampNormRect`) — none of that is redefined here.
 */

import {
  FIELD_TYPE_META,
  clampNormRect,
  type NormRect,
  type SignFieldType,
} from './field-geometry';
import type { PagePhrases, Phrase } from './pdf-text';

/** The four label families auto-placement knows how to find. */
export type AnchorKind = 'signature' | 'date' | 'name' | 'amount';

/**
 * Keyword dictionary per anchor kind. Values are already normalized (lowercase,
 * no whitespace/brackets) so they compare directly against a normalized phrase.
 * Order within a kind is display-only; matching is presence, not position.
 */
export const ANCHOR_KEYWORDS: Record<AnchorKind, readonly string[]> = {
  signature: ['서명', '사인', 'signature', '인'],
  date: ['날짜', 'date', '작성일'],
  name: ['이름', '성명', 'name'],
  amount: ['금액', '원', 'amount'],
};

/**
 * Priority order used when a phrase matches more than one kind (e.g. "성명 및
 * 서명"). Earlier wins — signature and date, the more distinctive labels, take
 * precedence over the broader text kinds.
 */
export const ANCHOR_KIND_ORDER: readonly AnchorKind[] = [
  'signature',
  'date',
  'name',
  'amount',
];

/**
 * Which persisted field type each kind produces. Amount has no dedicated field
 * type in this scope, so it maps to a plain text field suitable for entering a
 * number (per B안: a text-shaped 금액 입력란, no calculation).
 */
export const ANCHOR_FIELD_TYPE: Record<AnchorKind, SignFieldType> = {
  signature: 'SIGNATURE',
  date: 'DATE',
  name: 'TEXT',
  amount: 'TEXT',
};

/** One recommended field, page-relative and ready for the field pipeline. */
export interface FieldCandidate {
  /** The anchor family that produced this candidate. */
  kind: AnchorKind;
  /** The persisted field type to create (from {@link ANCHOR_FIELD_TYPE}). */
  type: SignFieldType;
  /** Bottom-left 0..1 box, in-page (already `clampNormRect`-ed). */
  rect: NormRect;
  /** 1-based page the anchor (and thus the candidate) lives on. */
  page: number;
  /** The exact phrase text the match fired on (for UI / debugging). */
  anchorText: string;
}

/** Horizontal gap between an anchor and a field placed to its right (0..1). */
const RIGHT_GAP = 0.01;
/** Vertical gap between an anchor and a field dropped below it (0..1). */
const BELOW_GAP = 0.01;

/**
 * Normalize a phrase for matching: lowercase, and strip whitespace plus the
 * bracket family (so "(인)" → "인", "성 명" → "성명", "ＮＡＭＥ" folds via
 * lowercase). Kept deliberately narrow — punctuation like ":" survives, which is
 * harmless because substring keywords still match around it.
 */
export function normalizeAnchorText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s()[\]{}（）「」『』【】〔〕<>]/g, '');
}

/**
 * Whether a normalized phrase carries a keyword. Multi-character keywords match
 * as substrings; single-character Korean anchors ("인", "원") match only when
 * they are the entire phrase, so they don't fire on words that merely contain
 * the syllable ("확인", "지원", "원본").
 */
function phraseHasKeyword(normalized: string, keyword: string): boolean {
  if (keyword.length >= 2) return normalized.includes(keyword);
  return normalized === keyword;
}

/**
 * Classify a single phrase into an anchor kind, or `null` if it matches none.
 * When several kinds match, {@link ANCHOR_KIND_ORDER} breaks the tie.
 */
export function classifyAnchor(text: string): AnchorKind | null {
  const normalized = normalizeAnchorText(text);
  if (normalized.length === 0) return null;
  for (const kind of ANCHOR_KIND_ORDER) {
    for (const keyword of ANCHOR_KEYWORDS[kind]) {
      if (phraseHasKeyword(normalized, keyword)) return kind;
    }
  }
  return null;
}

/** Field box placed to the right of the anchor, vertically centered on it. */
function rightOf(anchor: NormRect, size: { width: number; height: number }): NormRect {
  const centerY = anchor.y + anchor.height / 2;
  return {
    x: anchor.x + anchor.width + RIGHT_GAP,
    y: centerY - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

/** Field box dropped below the anchor, left edges aligned. */
function below(anchor: NormRect, size: { width: number; height: number }): NormRect {
  return {
    x: anchor.x,
    y: anchor.y - BELOW_GAP - size.height,
    width: size.width,
    height: size.height,
  };
}

/**
 * Pick the candidate rect for one anchor: to its right by default, or below when
 * a default-sized box wouldn't fit in the remaining right margin. The result is
 * clamped into the page so it is always a valid, fully-visible field box.
 */
function placeCandidate(anchor: NormRect, type: SignFieldType): NormRect {
  const size = FIELD_TYPE_META[type].defaultSize;
  const right = rightOf(anchor, size);
  const chosen = right.x + right.width > 1 ? below(anchor, size) : right;
  return clampNormRect(chosen);
}

/**
 * Turn extracted per-page phrases into typed field candidates.
 *
 * Pure and order-preserving: walks pages then phrases in reading order, and for
 * every phrase that classifies as an anchor emits one candidate placed by
 * {@link placeCandidate}. Non-anchor phrases are skipped; pages with no anchors
 * contribute nothing. No dedup or conflict resolution against existing fields —
 * that's a later grain's job.
 */
export function phrasesToFieldCandidates(pages: PagePhrases[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  for (const { page, phrases } of pages) {
    for (const phrase of phrases as Phrase[]) {
      const kind = classifyAnchor(phrase.text);
      if (kind === null) continue;
      const type = ANCHOR_FIELD_TYPE[kind];
      candidates.push({
        kind,
        type,
        rect: placeCandidate(phrase.rect, type),
        page,
        anchorText: phrase.text,
      });
    }
  }
  return candidates;
}
