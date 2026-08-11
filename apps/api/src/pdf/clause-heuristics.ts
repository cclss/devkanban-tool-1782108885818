/**
 * Pure, dependency-free heuristics that turn per-page contract text into the
 * top 1–5 clause cards for the signer screen. No `pdfjs-dist`, no Nest, no IO —
 * every function here is deterministic over its input, so it is unit-tested in
 * isolation (`clause-heuristics.spec.ts`).
 *
 * Pipeline: {@link selectClauses} concatenates the pages (tracking which page
 * each character came from for deep-link anchors), splits the document into
 * candidate blocks on Korean article headers ("제N조 …") with paragraph
 * fallbacks, scores each block, keeps the best ≤5, and renders each survivor
 * into an {@link ExtractedClause}.
 */

import type {
  ClauseFigure,
  ClauseFigureKind,
  ExtractedClause,
  PageText,
} from './clause-extraction.types';

/** Max cards a document may surface (spec: "최소 1장, 최대 5장"). */
export const MAX_CLAUSES = 5;

/** Cap on the plain-language body length so a card stays scannable. */
const PLAIN_TEXT_MAX = 160;

/**
 * Risk keywords that flip a clause into the warning ("주의") tone. Substring
 * match against the raw body — deliberately broad, since a false warning is far
 * cheaper than a missed one on a legal document.
 */
const CAUTION_KEYWORDS: readonly string[] = [
  '위약금',
  '위약',
  '손해배상',
  '배상',
  '해지',
  '해제',
  '지연',
  '연체',
  '벌금',
  '과태료',
  '면책',
  '불이익',
  '자동 갱신',
  '자동갱신',
  '원상복구',
  '몰수',
  '담보',
  '연대보증',
  '지체상금',
  '페널티',
  '위반',
  '책임',
];

/**
 * Small, conservative legalese → plain-language dictionary. Applied to the body
 * before trimming so the card reads a little closer to everyday Korean. Kept
 * intentionally small: only unambiguous rewrites that never change meaning.
 */
const PLAIN_LANGUAGE_RULES: readonly [RegExp, string][] = [
  [/본\s*계약/g, '이 계약'],
  [/본\s*조/g, '이 조항'],
  [/당사자/g, '계약을 맺는 사람'],
  [/상기/g, '위에서 말한'],
  [/기재된/g, '적힌'],
  [/의무를\s*부담한다/g, '해야 한다'],
  [/하여야\s*한다/g, '해야 한다'],
  [/지급하여야/g, '내야'],
  [/지급한다/g, '낸다'],
];

/**
 * Figure patterns, in priority order. When two matches overlap, the earlier
 * (higher-priority) kind wins — a "2026년 1월 31일" is a date, not a period.
 */
const FIGURE_PATTERNS: readonly { kind: ClauseFigureKind; re: RegExp }[] = [
  {
    kind: 'date',
    re: /\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/g,
  },
  {
    kind: 'money',
    re: /(?:₩|US\$|\$)?\s?\d[\d,]*(?:\.\d+)?\s*(?:억원|만원|억|만|원|달러|USD|KRW)/g,
  },
  {
    kind: 'period',
    re: /\d+\s*(?:개월|년|주일|주|일|시간)(?:간)?/g,
  },
];

/**
 * Matches a Korean article header and (optionally) its parenthesized title.
 * Examples matched: "제3조", "제 12 조 (계약기간)", "제1조【목적】".
 */
const ARTICLE_HEADER =
  /제\s*(\d+)\s*조\s*(?:[(（【]\s*([^)）】\n]+?)\s*[)）】])?/g;

/** A candidate clause carved out of the document before scoring. */
interface RawBlock {
  /** Title line (article header, or a synthesized fallback). */
  title: string;
  /** Everything after the title up to the next block. */
  body: string;
  /** 1-based page the block starts on. */
  page: number;
}

/**
 * Concatenate pages into one string plus an offset→page resolver. A trailing
 * newline separates pages so a header at a page boundary is never glued to the
 * previous page's last word.
 */
function buildDocument(pages: PageText[]): {
  text: string;
  pageAt: (offset: number) => number;
} {
  const boundaries: { start: number; page: number }[] = [];
  let text = '';
  for (const p of pages) {
    boundaries.push({ start: text.length, page: p.page });
    text += (p.text ?? '') + '\n';
  }
  const pageAt = (offset: number): number => {
    let page = boundaries.length > 0 ? boundaries[0].page : 1;
    for (const b of boundaries) {
      if (offset >= b.start) page = b.page;
      else break;
    }
    return page;
  };
  return { text, pageAt };
}

/** Collapse all runs of whitespace to single spaces and trim. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split the document into candidate blocks. Primary strategy: cut on Korean
 * article headers. If a document has none, fall back to blank-line paragraphs;
 * if it has neither, the whole (non-empty) document is a single block.
 */
function segment(
  text: string,
  pageAt: (offset: number) => number,
): RawBlock[] {
  const headers: { index: number; num: string; title?: string }[] = [];
  ARTICLE_HEADER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARTICLE_HEADER.exec(text)) !== null) {
    headers.push({ index: m.index, num: m[1], title: m[2] });
  }

  if (headers.length > 0) {
    const blocks: RawBlock[] = [];
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const end = i + 1 < headers.length ? headers[i + 1].index : text.length;
      const raw = text.slice(h.index, end);
      const bodyStart = raw.indexOf('\n');
      const body = bodyStart >= 0 ? raw.slice(bodyStart + 1) : raw;
      const title = h.title
        ? `제${h.num}조 (${normalizeWhitespace(h.title)})`
        : `제${h.num}조`;
      blocks.push({
        title,
        body: normalizeWhitespace(body),
        page: pageAt(h.index),
      });
    }
    return blocks;
  }

  // Fallback: paragraphs separated by blank lines.
  const paras = text
    .split(/\n{2,}/)
    .map((p) => ({ raw: p, start: 0 }))
    .filter((p) => normalizeWhitespace(p.raw).length > 0);

  if (paras.length === 0) return [];

  if (paras.length === 1) {
    const only = normalizeWhitespace(paras[0].raw);
    return [{ title: synthesizeTitle(only), body: only, page: pageAt(0) }];
  }

  // Re-scan to recover each paragraph's absolute offset for page anchoring.
  const blocks: RawBlock[] = [];
  let cursor = 0;
  for (const rawPara of text.split(/\n{2,}/)) {
    const offset = text.indexOf(rawPara, cursor);
    cursor = offset + rawPara.length;
    const body = normalizeWhitespace(rawPara);
    if (body.length === 0) continue;
    blocks.push({
      title: synthesizeTitle(body),
      body,
      page: pageAt(offset >= 0 ? offset : 0),
    });
  }
  return blocks;
}

/** Build a short title from a headerless paragraph's first clause/sentence. */
function synthesizeTitle(body: string): string {
  const firstSentence = body.split(/[.。\n]/)[0] ?? body;
  const trimmed = normalizeWhitespace(firstSentence);
  return trimmed.length > 40 ? trimmed.slice(0, 40).trim() + '…' : trimmed;
}

/** `true` when any risk keyword appears in the text. */
export function detectCaution(text: string): boolean {
  return CAUTION_KEYWORDS.some((k) => text.includes(k));
}

/**
 * Extract key figures (money / period / date) in reading order, resolving
 * overlaps by pattern priority and de-duplicating identical values.
 */
export function extractFigures(text: string): ClauseFigure[] {
  interface Hit {
    kind: ClauseFigureKind;
    value: string;
    start: number;
    end: number;
    priority: number;
  }
  const hits: Hit[] = [];
  FIGURE_PATTERNS.forEach(({ kind, re }, priority) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = m[0].trim();
      if (value.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      hits.push({
        kind,
        value,
        start: m.index,
        end: m.index + m[0].length,
        priority,
      });
    }
  });

  // Resolve overlaps: keep higher-priority (lower index) matches; drop any
  // remaining hit whose span intersects an already-accepted one.
  hits.sort((a, b) => a.priority - b.priority || a.start - b.start);
  const accepted: Hit[] = [];
  for (const hit of hits) {
    const clashes = accepted.some(
      (a) => hit.start < a.end && a.start < hit.end,
    );
    if (!clashes) accepted.push(hit);
  }

  accepted.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const figures: ClauseFigure[] = [];
  for (const h of accepted) {
    const key = `${h.kind}:${h.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    figures.push({ kind: h.kind, value: h.value });
  }
  return figures;
}

/** Render a clause body into a capped, plain-language summary. */
export function toPlainLanguage(body: string): string {
  let out = normalizeWhitespace(body);
  for (const [re, replacement] of PLAIN_LANGUAGE_RULES) {
    out = out.replace(re, replacement);
  }
  if (out.length <= PLAIN_TEXT_MAX) return out;
  // Prefer to cut at a sentence boundary within the cap, else hard-truncate.
  const capped = out.slice(0, PLAIN_TEXT_MAX);
  const lastStop = Math.max(capped.lastIndexOf('. '), capped.lastIndexOf('다.'));
  if (lastStop >= PLAIN_TEXT_MAX * 0.5) {
    return capped.slice(0, lastStop + 1).trim();
  }
  return capped.trim() + '…';
}

/**
 * Importance score for ranking blocks when there are more than {@link
 * MAX_CLAUSES}. Figures and risk language are what a signer most needs to see,
 * so they weigh heaviest; a recognizable article title and a substantive
 * (but not runaway) length break ties.
 */
function scoreBlock(block: RawBlock): number {
  const figures = extractFigures(block.body);
  const caution = detectCaution(block.body);
  const hasArticleTitle = /^제\d+조/.test(block.title);
  const len = block.body.length;
  const lengthBonus = len >= 40 && len <= 600 ? 1 : 0;
  return (
    figures.length * 2 +
    (caution ? 3 : 0) +
    (hasArticleTitle ? 1 : 0) +
    lengthBonus
  );
}

/**
 * Turn per-page contract text into the top 1–5 structured clause cards.
 *
 * Empty / whitespace-only input yields `[]` (spec: no cards → straight to the
 * original view, no error screen). When more than {@link MAX_CLAUSES} candidate
 * blocks exist, the highest-scoring five are kept and re-ordered back into
 * reading order so the cards still match the document's flow.
 */
export function selectClauses(pages: PageText[]): ExtractedClause[] {
  if (!pages || pages.length === 0) return [];
  const { text, pageAt } = buildDocument(pages);
  if (normalizeWhitespace(text).length === 0) return [];

  const blocks = segment(text, pageAt).filter(
    (b) => b.body.length > 0 || b.title.length > 0,
  );
  if (blocks.length === 0) return [];

  const ranked = blocks
    .map((block, order) => ({ block, order, score: scoreBlock(block) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_CLAUSES)
    .sort((a, b) => a.order - b.order);

  return ranked.map(({ block }) => ({
    title: block.title,
    plainText: toPlainLanguage(block.body || block.title),
    figures: extractFigures(block.body),
    caution: detectCaution(`${block.title} ${block.body}`),
    page: block.page,
  }));
}
