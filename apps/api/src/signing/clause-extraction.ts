/**
 * Server-side contract-highlight extraction (grain-5).
 *
 * Turns the raw text of a contract PDF into 3–5 plain-language "highlight cards"
 * so a signer can grasp what matters — parties, key figures, obligations, and
 * risky clauses — without scrolling the whole document. The heavy visual card is
 * built later (grain-6, front-end); this module owns the *content* decision:
 * which clauses surface and how legal jargon is translated into everyday Korean.
 *
 * Everything here is a pure function of the extracted text — no PDF parsing, no
 * I/O — so the translation tone and detection rules are unit-testable in
 * isolation. The legal→everyday glossary and the caution-tone split are recorded
 * in the design spec (tone/clause-translation.md); this file is their
 * implementation and must stay in sync with that record.
 */

/** One page of extracted text, 1-based page number. */
export interface PageText {
  page: number;
  text: string;
}

/** Semantic category of a highlight card. */
export type HighlightCategory =
  | 'parties'
  | 'money'
  | 'term'
  | 'obligation'
  | 'caution';

/**
 * Visual/voice tone for a card. `caution` clauses (penalties, liability,
 * auto-renewal…) are the ones a signer most needs to notice, so they carry a
 * distinct tone the UI renders differently (grain-6 caution Variant).
 */
export type HighlightTone = 'default' | 'caution';

export interface HighlightSource {
  /** 1-based page the excerpt was found on (0 when unknown). */
  page: number;
  /** Original contract text the card summarizes — anchors the "원문 보기" jump. */
  excerpt: string;
}

export interface ContractHighlight {
  /** Stable id (category-scoped) so the client can key/deep-link cards. */
  id: string;
  category: HighlightCategory;
  /** Everyday-language heading. */
  title: string;
  /** Plain-language, honorific one-liner built from the captured values. */
  summary: string;
  tone: HighlightTone;
  source: HighlightSource;
}

export interface HighlightsResult {
  /**
   * False when no text could be extracted (scanned/image-only PDF or a parse
   * failure). The client shows a graceful "요약을 만들 수 없어요" fallback and the
   * signer falls back to the full document — never an error.
   */
  available: boolean;
  clauses: ContractHighlight[];
}

/** Done-when target: a normal contract surfaces 3–5 cards; hard cap at 5. */
export const MAX_HIGHLIGHTS = 5;

/**
 * Legal term → everyday Korean, in a warm, honorific (Toss-style) voice.
 * Recorded design decision — mirror any change into
 * `$GENOSIS_SPEC_PATH/tone/clause-translation.md`.
 */
export const LEGAL_GLOSSARY: Readonly<Record<string, string>> = {
  갑: '계약을 요청한 쪽',
  을: '서명하는 쪽(보통 나)',
  위약금: '약속을 어겼을 때 물어내야 하는 돈',
  손해배상: '상대가 입은 손해를 물어주는 것',
  지체상금: '약속한 날보다 늦어질 때 하루하루 쌓여 내는 돈',
  해지: '계약을 도중에 끝내는 것',
  해제: '계약을 처음부터 없던 일로 되돌리는 것',
  불이행: '약속한 일을 하지 않는 것',
  '자동 갱신': '따로 말하지 않으면 계약이 자동으로 연장되는 것',
  갱신: '계약 기간을 이어가는 것',
  면책: '책임을 지지 않아도 되는 것',
  연대보증: '남의 빚을 대신 갚아야 할 수도 있는 약속',
  위반: '약속을 어기는 것',
  과실: '실수나 부주의',
  귀책사유: '누구의 잘못인지',
  '기한의 이익 상실': '한 번 늦으면 남은 금액을 한꺼번에 갚아야 하는 것',
  준거법: '문제가 생겼을 때 따르는 법',
  관할: '다투게 되면 재판을 맡는 법원',
} as const;

/**
 * Terms that make a clause a *caution*. Ordered by how much a signer usually
 * needs to notice them (money-at-risk first). Multi-word terms come before their
 * single-word substrings so the longer match wins.
 */
const CAUTION_TERMS: readonly string[] = [
  '기한의 이익 상실',
  '연대보증',
  '위약금',
  '지체상금',
  '손해배상',
  '자동 갱신',
  '해지',
  '해제',
  '불이행',
  '면책',
  '위반',
];

/** Amounts: "1,000,000원", "500만원", "₩1,000", "KRW 1,000", "USD 100". */
const MONEY_RE =
  /(?:₩|\$|KRW|USD)?\s*\d[\d,]*\s*(?:억\s*)?(?:천\s*)?(?:백\s*)?만?\s*(?:원|원정|KRW|USD|달러|불)|\d[\d,]*\s*(?:원|만원|억원)/;

/** Durations & dates: "12개월", "2년", "3주", "30일", "2026-01-01", "2026년 1월 1일". */
const TERM_RE =
  /\d+\s*(?:개월|년|주|일)간?|\d{4}\s*[.\-년]\s*\d{1,2}\s*[.\-월]\s*\d{1,2}\s*일?|(?:부터|까지)/;

/** Party-identifying phrases. */
const PARTY_RE =
  /이하\s*['"“”']?\s*[갑을병정][’'"“”]?|주식회사|\(주\)|대표이사|당사자|계약자|성명\s*[:：]/;

/** Obligation phrasing: "…하여야 한다", "…해야 한다", "…의무", "지급한다"… */
const OBLIGATION_RE =
  /(?:하여야|해야)\s*한다|의무(?:를|가|는)?|지급(?:하여야|해야|한다|한다\.)|이행(?:하여야|해야|한다)|제공(?:하여야|해야|한다)|납부(?:하여야|해야|한다)/;

/**
 * Split contract text into trimmed sentences while remembering which page each
 * came from. Korean legal text is sentence-terminated by "다." and clause
 * numbering; we split on sentence enders and newlines and keep non-trivial ones.
 */
export function splitSentences(pages: PageText[]): Array<{ page: number; text: string }> {
  const out: Array<{ page: number; text: string }> = [];
  for (const { page, text } of pages) {
    const normalized = text.replace(/\r/g, '\n');
    // Break after sentence enders (다. 요. .) and on newlines; keep the ender.
    const parts = normalized
      .split(/(?<=[.。!?])\s+|(?<=다\.)\s*|\n+/)
      .map((s) => collapseWhitespace(s))
      .filter((s) => s.length >= 2);
    for (const text of parts) out.push({ page, text });
  }
  return out;
}

/** Collapse runs of whitespace to single spaces and trim. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Rewrite a legal excerpt into friendlier text by appending a plain-language
 * gloss the first time each known term appears: `해지(계약을 도중에 끝내는 것)`.
 * Non-destructive — the original wording is kept so nothing is misrepresented.
 */
export function translateLegalTerms(text: string): string {
  // Pick one non-overlapping match span per known term, longest terms first so
  // "자동 갱신" claims its span before the shorter "갱신" can — and the shorter
  // term is then rejected for overlapping it. Glosses are inserted afterwards, so
  // an inserted parenthetical is never itself re-scanned.
  const terms = Object.keys(LEGAL_GLOSSARY).sort((a, b) => b.length - a.length);
  const taken: Array<{ start: number; end: number }> = [];
  const chosen: Array<{ start: number; end: number; term: string }> = [];
  const overlaps = (start: number, end: number) =>
    taken.some((t) => start < t.end && end > t.start);

  for (const term of terms) {
    for (let idx = text.indexOf(term); idx !== -1; idx = text.indexOf(term, idx + 1)) {
      const end = idx + term.length;
      if (overlaps(idx, end)) continue;
      // Skip the bare 갑/을 gloss unless they read as standalone party markers —
      // otherwise every "을" particle in Korean prose would be annotated.
      if ((term === '갑' || term === '을') && !isPartyMarker(text, idx)) continue;
      taken.push({ start: idx, end });
      chosen.push({ start: idx, end, term });
      break; // one gloss per term
    }
  }

  chosen.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const m of chosen) {
    out += text.slice(cursor, m.end) + `(${LEGAL_GLOSSARY[m.term]})`;
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

/** True when 갑/을 at `idx` is used as a party label, not a grammatical particle. */
function isPartyMarker(text: string, idx: number): boolean {
  const before = text[idx - 1];
  const after = text[idx + 1];
  const boundary = (c: string | undefined) =>
    c === undefined || /[\s'"“”'()「」『』,.:：·]/.test(c);
  return boundary(before) && boundary(after);
}

/** Find the first sentence matching `re`, preferring earlier pages. */
function firstMatch(
  sentences: Array<{ page: number; text: string }>,
  re: RegExp,
): { page: number; text: string } | null {
  for (const s of sentences) {
    if (re.test(s.text)) return s;
  }
  return null;
}

/** Trim an excerpt to a readable length without cutting mid-gloss. */
function clampExcerpt(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Extract 3–5 plain-language highlight cards from a contract's page texts.
 *
 * Detection is deterministic and order-stable: one card per category when found,
 * emitted in reading-priority order (who → how much → how long → what I must do →
 * what to watch out for), capped at {@link MAX_HIGHLIGHTS}. A caution card is
 * emitted for the single most important risky term present.
 */
export function extractHighlights(pages: PageText[]): ContractHighlight[] {
  const sentences = splitSentences(pages);
  if (sentences.length === 0) return [];

  const cards: ContractHighlight[] = [];

  // ── who: the parties ────────────────────────────────────────────────────
  const party = firstMatch(sentences, PARTY_RE);
  if (party) {
    cards.push({
      id: 'parties',
      category: 'parties',
      title: '계약을 맺는 사람',
      summary: `이 계약을 맺는 양쪽이에요. ${translateLegalTerms(clampExcerpt(party.text))}`,
      tone: 'default',
      source: { page: party.page, excerpt: clampExcerpt(party.text) },
    });
  }

  // ── how much: money ─────────────────────────────────────────────────────
  const money = firstMatch(sentences, MONEY_RE);
  if (money) {
    const amount = money.text.match(MONEY_RE)?.[0]?.trim();
    cards.push({
      id: 'money',
      category: 'money',
      title: '주고받는 금액',
      summary: amount
        ? `계약 금액은 ${collapseWhitespace(amount)}이에요. 금액이 맞는지 꼭 확인하세요.`
        : `계약 금액이 적혀 있어요. ${clampExcerpt(money.text)}`,
      tone: 'default',
      source: { page: money.page, excerpt: clampExcerpt(money.text) },
    });
  }

  // ── how long: term / dates ──────────────────────────────────────────────
  const term = firstMatch(sentences, TERM_RE);
  if (term) {
    const span = term.text.match(TERM_RE)?.[0]?.trim();
    cards.push({
      id: 'term',
      category: 'term',
      title: '계약 기간',
      summary: span
        ? `계약 기간과 관련된 내용이에요: ${clampExcerpt(term.text)}`
        : `계약 기간이 정해져 있어요. ${clampExcerpt(term.text)}`,
      tone: 'default',
      source: { page: term.page, excerpt: clampExcerpt(term.text) },
    });
  }

  // ── what I must do: obligations ─────────────────────────────────────────
  const obligation = firstMatch(sentences, OBLIGATION_RE);
  if (obligation) {
    cards.push({
      id: 'obligation',
      category: 'obligation',
      title: '내가 꼭 해야 하는 일',
      summary: `지켜야 할 약속이 있어요. ${translateLegalTerms(clampExcerpt(obligation.text))}`,
      tone: 'default',
      source: { page: obligation.page, excerpt: clampExcerpt(obligation.text) },
    });
  }

  // ── what to watch out for: cautions ─────────────────────────────────────
  const cautionCard = findCaution(sentences);
  if (cautionCard) cards.push(cautionCard);

  return cards.slice(0, MAX_HIGHLIGHTS);
}

/**
 * Build the single most important caution card: scan for the highest-priority
 * risky term present and translate it. Kept separate so the caution tone/logic
 * has one home.
 */
function findCaution(
  sentences: Array<{ page: number; text: string }>,
): ContractHighlight | null {
  for (const term of CAUTION_TERMS) {
    for (const s of sentences) {
      if (!s.text.includes(term)) continue;
      const gloss = LEGAL_GLOSSARY[term] ?? '';
      return {
        id: 'caution',
        category: 'caution',
        title: '꼭 확인해야 할 주의 조항',
        summary: gloss
          ? `‘${term}’ 조항이 있어요 — ${gloss}. 서명 전에 꼭 확인하세요.`
          : `주의해서 볼 조항이 있어요. ${translateLegalTerms(clampExcerpt(s.text))}`,
        tone: 'caution',
        source: { page: s.page, excerpt: clampExcerpt(s.text) },
      };
    }
  }
  return null;
}
