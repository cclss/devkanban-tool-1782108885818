import { SignFieldType } from '@repo/db';
import type { DetectedFieldType } from './field-detection.types';

/**
 * A keyword/pattern rule mapping a label to a proposed field type + a base
 * confidence. Confidences are intentionally coarse (0.5 = weak/ambiguous cue,
 * 0.7 = solid, 0.85–0.9 = strong unambiguous label). Structural cues (a trailing
 * colon, an underline blank) nudge the score up at detection time.
 *
 * These are internal heuristic-engine settings, not design tokens — changing a
 * threshold or a keyword produces no user-visible visual change.
 */
export interface KeywordRule {
  /** Tested (case-insensitively, unicode-aware) against a token's text. */
  pattern: RegExp;
  /** Field type proposed when the pattern matches. */
  type: DetectedFieldType;
  /** Base confidence in 0..1 before structural adjustments. */
  confidence: number;
}

const S = SignFieldType.SIGNATURE;
const D = SignFieldType.DATE;
const T = SignFieldType.TEXT;

/**
 * Bilingual (Korean/English) label dictionary for the three in-scope field
 * types. Ordered strong→weak only for readability; the detector always keeps the
 * single highest-confidence match per label, so order does not affect results.
 */
export const KEYWORD_RULES: readonly KeywordRule[] = [
  // --- Signature -----------------------------------------------------------
  { pattern: /서명/, type: S, confidence: 0.9 },
  { pattern: /signature/i, type: S, confidence: 0.9 },
  { pattern: /자필/, type: S, confidence: 0.85 },
  { pattern: /날인/, type: S, confidence: 0.85 },
  { pattern: /\(인\)|（인）/, type: S, confidence: 0.7 },
  { pattern: /\bsign(ed|\s*here)?\b/i, type: S, confidence: 0.5 }, // ambiguous
  { pattern: /\bseal\b/i, type: S, confidence: 0.5 },

  // --- Date ----------------------------------------------------------------
  { pattern: /날짜/, type: D, confidence: 0.9 },
  { pattern: /\bdate\b/i, type: D, confidence: 0.9 },
  { pattern: /일자/, type: D, confidence: 0.85 },
  { pattern: /계약일|작성일|발행일|서명일/, type: D, confidence: 0.85 },
  { pattern: /생년월일/, type: D, confidence: 0.85 },
  { pattern: /년\s*월\s*일/, type: D, confidence: 0.8 },
  { pattern: /20\d{2}\s*[.\-/년]/, type: D, confidence: 0.7 }, // year-prefixed blank

  // --- Text ----------------------------------------------------------------
  { pattern: /성명/, type: T, confidence: 0.8 },
  { pattern: /\bname\b/i, type: T, confidence: 0.75 },
  { pattern: /주소/, type: T, confidence: 0.75 },
  { pattern: /\baddress\b/i, type: T, confidence: 0.75 },
  { pattern: /이메일|메일/, type: T, confidence: 0.72 },
  { pattern: /\be-?mail\b/i, type: T, confidence: 0.72 },
  { pattern: /연락처|전화|휴대폰/, type: T, confidence: 0.72 },
  { pattern: /\b(phone|tel|mobile)\b/i, type: T, confidence: 0.7 },
  { pattern: /이름/, type: T, confidence: 0.7 },
  { pattern: /주민등록번호|사업자등록번호/, type: T, confidence: 0.7 },
  { pattern: /소속|직위|직책|부서|회사|상호/, type: T, confidence: 0.5 }, // weak
  { pattern: /금액|수량/, type: T, confidence: 0.5 }, // weak
];

/** A single label→type resolution, already structure-adjusted. */
export interface KeywordMatch {
  type: DetectedFieldType;
  confidence: number;
}

/**
 * Resolve a token's text to at most one field type — the highest-confidence
 * matching rule, adjusted for structural cues:
 *   - a trailing/embedded colon (`서명:` / `Name：`) signals a labeled blank → +0.05
 *   - a trailing underline run (`서명 ____`) signals an inline blank → +0.05
 * Returns `null` when no rule matches. Confidence is clamped to 0..1.
 */
export function matchKeyword(rawText: string): KeywordMatch | null {
  const text = rawText.trim();
  if (!text) return null;

  let best: KeywordMatch | null = null;
  for (const rule of KEYWORD_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (!best || rule.confidence > best.confidence) {
      best = { type: rule.type, confidence: rule.confidence };
    }
  }
  if (!best) return null;

  let bonus = 0;
  if (/[:：]/.test(text)) bonus += 0.05;
  if (/_{2,}$|_{2,}\s*$/.test(text)) bonus += 0.05;

  return { type: best.type, confidence: clamp01(best.confidence + bonus) };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
