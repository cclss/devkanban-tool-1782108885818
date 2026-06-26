/**
 * AI sign-field suggestion engine — pure core.
 *
 * Given the text tokens extracted from a PDF (later by pdfjs in grain-2, or a
 * server/LLM extractor), this proposes where SIGNATURE / DATE / TEXT fields
 * should go and how confident it is. It is deliberately a framework-, DOM- and
 * network-free pure function so the placement logic is unit-testable in
 * isolation and the *extractor* can be swapped without touching the engine.
 *
 * The seam is the {@link TextToken} interface: anything that can produce
 * `{ text, page, rect }` (the rect in the same normalized, bottom-left,
 * 0..1 space as the persisted field model) can feed this engine — a heuristic
 * pdfjs reader today, an LLM judge tomorrow.
 *
 * Coordinates reuse `field-geometry.ts` wholesale:
 *   • {@link NormRect} — bottom-left origin, 0..1 of the page, `x`/`y` = the
 *     lower-left corner. Exactly the stored/server shape.
 *   • {@link clampNormRect} — every emitted rect is clamped fully in-page.
 *   • {@link FIELD_TYPE_META} — per-type default footprint, so AI-placed fields
 *     match hand-placed ones.
 *
 * The output extends the existing `SignFieldDraft` shape with `confidence`,
 * `source: 'ai'` and `anchorLabel`, so a suggestion can be accepted into the
 * wizard's field list unchanged.
 */

import {
  type NormRect,
  type SignFieldType,
  clampNormRect,
  FIELD_TYPE_META,
} from './field-geometry';

/**
 * One extracted text token. The {@link rect} is page-relative, normalized 0..1,
 * bottom-left origin — identical to {@link NormRect} — so the engine never has
 * to know the extractor's pixel sizes or the page dimensions.
 */
export interface TextToken {
  /** The token's text (a word, label, or run of blank underscores). */
  text: string;
  /** 1-based page number this token lives on. */
  page: number;
  /** Normalized bbox of the token (bottom-left origin, 0..1 of the page). */
  rect: NormRect;
}

/**
 * A proposed sign field. Superset of the wizard's `SignFieldDraft` (flat
 * normalized geometry) plus the AI metadata the "확인" step surfaces.
 */
export interface SignFieldSuggestion {
  id: string;
  type: SignFieldType;
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Heuristic confidence in (0, 1]; higher = stronger anchor evidence. */
  confidence: number;
  /** Marks the field as machine-proposed (vs. hand-placed). */
  source: 'ai';
  /** The anchor phrase that triggered this suggestion (for the UI label). */
  anchorLabel: string;
}

export interface SuggestOptions {
  /**
   * Cap suggestions per page (keeps the highest-confidence ones). Omitted =
   * no cap. Useful when an extractor is noisy.
   */
  maxPerPage?: number;
}

/** How an anchor's field is positioned relative to the anchor token. */
type Placement = 'right' | 'onBlank';

interface AnchorRule {
  /** Matched against the token text (case-insensitive). */
  pattern: RegExp;
  type: SignFieldType;
  placement: Placement;
  /** Base confidence before overlap/penalty adjustments. */
  baseConfidence: number;
}

/**
 * Anchor lexicon. Evaluated top-to-bottom; the first rule a token matches wins,
 * so order encodes precedence. Word boundaries (`\b`) keep the Latin anchors
 * from firing inside larger words (`design`, `username`).
 */
const ANCHOR_RULES: readonly AnchorRule[] = [
  // SIGNATURE — explicit signature/seal markers. "(인)" is a Korean seal stamp.
  {
    pattern: /서명|날인|서명란|\(\s*인\s*\)|\bsign(ature)?\b/i,
    type: 'SIGNATURE',
    placement: 'right',
    baseConfidence: 0.92,
  },
  // DATE — date labels.
  {
    pattern: /날짜|일자|작성일|\bdate\b/i,
    type: 'DATE',
    placement: 'right',
    baseConfidence: 0.88,
  },
  // TEXT label — name/identity labels that expect a written value beside them.
  {
    pattern: /성명|이름|\bname\b/i,
    type: 'TEXT',
    placement: 'right',
    baseConfidence: 0.82,
  },
  // TEXT blank — a run of underscores is a fill-in line; the field sits ON it.
  {
    pattern: /_{3,}/,
    type: 'TEXT',
    placement: 'onBlank',
    baseConfidence: 0.62,
  },
] as const;

/** Normalized gap placed to the right of an anchor before the field starts. */
const ANCHOR_GAP = 0.012;
/** Confidence multiplier applied when a field had to be nudged off an overlap. */
const OVERLAP_PENALTY = 0.8;
/** Minimum positive overlap (in each axis) that counts as a real collision. */
const OVERLAP_EPS = 1e-6;

/** A candidate before overlap resolution / id assignment. */
interface Candidate {
  type: SignFieldType;
  page: number;
  rect: NormRect;
  confidence: number;
  anchorLabel: string;
  /** Reading-order index (page, then top-to-bottom, left-to-right). */
  order: number;
}

function isFiniteRect(r: NormRect | undefined): r is NormRect {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

/** Find the first matching anchor rule for a token, or null. */
function matchAnchor(text: string): AnchorRule | null {
  for (const rule of ANCHOR_RULES) {
    if (rule.pattern.test(text)) return rule;
  }
  return null;
}

/** Compute the field rect for an anchor token, per its placement mode. */
function placeField(rule: AnchorRule, anchor: NormRect): NormRect {
  const { width: w, height: h } = FIELD_TYPE_META[rule.type].defaultSize;

  if (rule.placement === 'onBlank') {
    // Sit the field over the blank line: span the underscores, baseline-aligned
    // to the token's bottom so the user writes on the existing line.
    const width = Math.max(anchor.width, w);
    return clampNormRect({ x: anchor.x, y: anchor.y, width, height: h });
  }

  // 'right' — vertically centered on the anchor, nudged just past its right edge.
  const centerY = anchor.y + anchor.height / 2;
  return clampNormRect({
    x: anchor.x + anchor.width + ANCHOR_GAP,
    y: centerY - h / 2,
    width: w,
    height: h,
  });
}

/** Strict rectangle overlap (positive area in both axes). */
function overlaps(a: NormRect, b: NormRect): boolean {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ix > OVERLAP_EPS && iy > OVERLAP_EPS;
}

/**
 * Greedy overlap resolution for one page's candidates. Highest confidence wins
 * its spot; a colliding candidate is nudged *below* the fields it overlaps (and
 * penalized); if it still collides after the nudge, it is dropped. Deterministic
 * given the input order.
 */
function resolvePage(candidates: Candidate[]): Candidate[] {
  const byStrength = [...candidates].sort(
    (a, b) => b.confidence - a.confidence || a.order - b.order,
  );
  const accepted: Candidate[] = [];

  for (const cand of byStrength) {
    let rect = cand.rect;
    let confidence = cand.confidence;

    const clashing = accepted.filter((a) => overlaps(a.rect, rect));
    if (clashing.length > 0) {
      // Drop below the lowest bottom edge among the fields we collide with.
      const lowestBottom = Math.min(...clashing.map((a) => a.rect.y));
      rect = clampNormRect({
        ...rect,
        y: lowestBottom - ANCHOR_GAP - rect.height,
      });
      confidence = confidence * OVERLAP_PENALTY;

      if (accepted.some((a) => overlaps(a.rect, rect))) {
        // Still colliding (e.g. nudged into the page floor) — drop it.
        continue;
      }
    }

    accepted.push({ ...cand, rect, confidence });
  }

  return accepted;
}

/**
 * Propose sign fields from extracted text tokens.
 *
 * Never throws on empty / text-free input — a scanned PDF with no recoverable
 * text simply yields `[]`. Every returned rect is clamped fully in-page, and no
 * two returned fields on the same page overlap.
 *
 * Output is sorted by page, then reading order (top-to-bottom, left-to-right),
 * with stable `ai-N` ids.
 */
export function suggestSignFields(
  tokens: readonly TextToken[],
  options: SuggestOptions = {},
): SignFieldSuggestion[] {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];

  // 1. Normalize + filter junk, then assign a global reading order.
  const clean = tokens
    .filter(
      (t) =>
        t &&
        typeof t.text === 'string' &&
        t.text.trim().length > 0 &&
        Number.isInteger(t.page) &&
        t.page >= 1 &&
        isFiniteRect(t.rect),
    )
    .map((t) => ({ ...t, rect: clampNormRect(t.rect) }))
    // reading order: page asc, then top (high y) → bottom, then left → right.
    .sort(
      (a, b) =>
        a.page - b.page ||
        b.rect.y + b.rect.height - (a.rect.y + a.rect.height) ||
        a.rect.x - b.rect.x,
    );

  // 2. Detect anchors → candidates.
  const candidates: Candidate[] = [];
  clean.forEach((token, order) => {
    const rule = matchAnchor(token.text);
    if (!rule) return;
    candidates.push({
      type: rule.type,
      page: token.page,
      rect: placeField(rule, token.rect),
      confidence: rule.baseConfidence,
      anchorLabel: token.text.trim(),
      order,
    });
  });

  if (candidates.length === 0) return [];

  // 3. Resolve overlaps per page, optionally cap per page.
  const byPage = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const list = byPage.get(c.page);
    if (list) list.push(c);
    else byPage.set(c.page, [c]);
  }

  const resolved: Candidate[] = [];
  for (const list of byPage.values()) {
    let page = resolvePage(list);
    if (options.maxPerPage != null && page.length > options.maxPerPage) {
      page = [...page]
        .sort((a, b) => b.confidence - a.confidence || a.order - b.order)
        .slice(0, options.maxPerPage);
    }
    resolved.push(...page);
  }

  // 4. Sort to output order and assign stable ids.
  resolved.sort((a, b) => a.page - b.page || a.order - b.order);

  return resolved.map((c, i) => ({
    id: `ai-${i + 1}`,
    type: c.type,
    page: c.page,
    x: c.rect.x,
    y: c.rect.y,
    width: c.rect.width,
    height: c.rect.height,
    confidence: Math.min(1, Math.max(0, c.confidence)),
    source: 'ai' as const,
    anchorLabel: c.anchorLabel,
  }));
}
