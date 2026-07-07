/**
 * Clause-summary presentation helpers — the pure, DOM-free logic behind the
 * "핵심 조항 카드" reading surface (see design-spec/components/clause-card).
 *
 * Two decisions live here so they can be unit-tested in isolation from React:
 *   1. `splitKeyNumbers` — find the "핵심 수치" (amounts / ratios / durations /
 *      dates) inside a headline or detail sentence so the card can bold *just*
 *      those runs while keeping the sentence flowing (Toss benchmark: "위약금은
 *      계약금의 **10%**예요"). Emphasis is weight-only, never a hue — the card
 *      keeps the text `foreground` and lets bold carry the signal (avoids
 *      color-alone + tinted-background AA failure, per clause-card/base.md).
 *   2. `clauseTone` — map the `emphasis` vocabulary (`normal` | `caution`) onto
 *      the project's existing feedback tone (neutral vs warning). Data-driven,
 *      exactly like UrgencyBadge maps Urgency onto danger/warning — no Variant
 *      is derived. `caution` never escalates to `danger` (reserved for the
 *      urgency axis; the summary helps, it doesn't alarm).
 */

import type { ClauseEmphasis } from '@repo/db';

/** One run of a sentence: `highlight` marks a key number to render in bold. */
export interface ClauseTextSegment {
  text: string;
  /** True ⇒ a key number (amount/ratio/duration/date) — render bold. */
  highlight: boolean;
}

/**
 * Matches a single "key number" run inside Korean contract prose. Alternatives
 * are ordered longest-first so a full date wins over its leading year:
 *   • `2024년 1월 1일` / `2024년` / `1월 1일`  — Korean date parts
 *   • `2024-01-01` / `2024.01.01` / `2024/01/01` — delimited dates
 *   • `10%` · `1,000,000원` · `24개월` · `30일` · `2년` — amount / ratio / duration
 * The amount/duration arm requires a leading digit, so it never matches empty.
 */
const KEY_NUMBER_PATTERN = new RegExp(
  [
    '\\d{1,4}\\s*년(?:\\s*\\d{1,2}\\s*월)?(?:\\s*\\d{1,2}\\s*일)?',
    '\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일',
    '\\d{4}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}',
    '\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|퍼센트|원|만\\s*원|억\\s*원|만|억|천|개월|일|주일|주|시간|분|초|회|명|건|배|년)?',
  ].join('|'),
  'g',
);

/**
 * Split `text` into ordered segments, flagging the key-number runs. Rejoining
 * every `segment.text` reproduces the input exactly (lossless), so a caller can
 * render each segment as a span and bold only the highlighted ones.
 */
export function splitKeyNumbers(text: string): ClauseTextSegment[] {
  const segments: ClauseTextSegment[] = [];
  let cursor = 0;
  // Fresh state per call (the regex is global/stateful).
  KEY_NUMBER_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(KEY_NUMBER_PATTERN)) {
    const matched = match[0];
    const start = match.index ?? 0;
    if (matched.length === 0) continue; // defensive: never advance on an empty match
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlight: false });
    }
    segments.push({ text: matched, highlight: true });
    cursor = start + matched.length;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }
  return segments;
}

/** Semantic tone the card surface adopts for an `emphasis` value. */
export type ClauseToneName = 'neutral' | 'warning';

/** The resolved visual mapping for one clause's `emphasis`. */
export interface ClauseTone {
  /** Project feedback tone this emphasis maps onto. */
  tone: ClauseToneName;
  /** `caution` ⇒ show the warning mark + "주의" label (never color-alone). */
  caution: boolean;
  /** Card surface + border utility classes (token-backed; no raw values). */
  surfaceClassName: string;
  borderClassName: string;
}

const NEUTRAL_TONE: ClauseTone = {
  tone: 'neutral',
  caution: false,
  surfaceClassName: 'bg-surface',
  borderClassName: 'border-border',
};

const CAUTION_TONE: ClauseTone = {
  tone: 'warning',
  caution: true,
  surfaceClassName: 'bg-warning-subtle',
  borderClassName: 'border-warning',
};

/**
 * Map a clause's `emphasis` onto its card tone. `caution` → warning (subtle
 * tint + warning border + mark); anything else → neutral. The union is closed
 * to `'normal' | 'caution'`, so `normal` (and any unexpected value) falls back
 * to the calm neutral treatment.
 */
export function clauseTone(emphasis: ClauseEmphasis): ClauseTone {
  return emphasis === 'caution' ? CAUTION_TONE : NEUTRAL_TONE;
}
