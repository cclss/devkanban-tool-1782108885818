import type { ClauseSummary, ClauseSummaryClause, ClauseEmphasis } from '@repo/db';

/**
 * Default LLM model for clause-summary generation. Overridable via the
 * `CLAUSE_SUMMARY_MODEL` env var. This is an implementation setting (which
 * engine produces the summary), not a user-facing design decision.
 */
export const DEFAULT_CLAUSE_SUMMARY_MODEL = 'claude-opus-4-8';

/**
 * BullMQ queue name for background clause-summary generation. Mirrors the
 * completion pipeline's queue/worker convention (`completion.constants.ts`):
 * when the send flow triggers a summary, a `clause-summary` job is enqueued
 * and a co-located worker runs `ClauseSummaryService.generate`. When REDIS_URL
 * is unset the queue degrades to an inline run so sending still works locally.
 */
export const CLAUSE_SUMMARY_QUEUE = 'clause-summary';

/** Job name within the clause-summary queue. */
export const CLAUSE_SUMMARY_JOB = 'generate-clause-summary';

/** Payload carried by a clause-summary generation job. */
export interface ClauseSummaryJobData {
  /** The document whose original PDF should be summarized. */
  documentId: string;
}

/**
 * Upper bound on how much extracted PDF text we feed the model. Contracts can
 * be long; this caps token cost/latency. Implementation setting — not a design
 * token. When the source exceeds this, the tail is dropped and the model is
 * told the text was truncated (it still summarizes the leading clauses).
 */
export const MAX_INPUT_CHARS = 60_000;

/**
 * Target clause count. The clause-summary data contract (design-spec
 * `vocabulary/clause-summary.md`) treats 3–5 as a generation guideline, not a
 * hard content contract, so we clamp the upper bound and never pad.
 */
export const MAX_CLAUSES = 5;

/** Closed emphasis union from the shared `ClauseSummary` contract. */
const VALID_EMPHASIS: ReadonlySet<ClauseEmphasis> = new Set(['normal', 'caution']);

/**
 * System prompt for clause-summary generation.
 *
 * The summary text is user-facing copy shown on the signer/share reading
 * screen, so the tone/structure here inherits the project's established voice:
 *   - Base voice (design-spec `messaging/recording.md`): 해요체, 탓하지 않기,
 *     과장·불안 조성 금지, 내부 사정/엔진 용어 비노출.
 *   - AI copy tone (design-spec `messaging/ai-copy.md`): AI는 단정하지 않는
 *     조력자. 엔진 종류/신뢰도 같은 내부 용어를 감춘다.
 *   - Clause-card structure (design-spec `vocabulary/clause-summary.md` +
 *     `components/summary-card`): 한 줄 요지(oneLiner) → 구어체 헤드라인 →
 *     핵심 수치 강조 → 주의 조항은 `emphasis: caution`으로 구분(위약·자동
 *     갱신·책임·해지 등 warning 계열 의미).
 *
 * The "AI 요약이며 정확한 내용은 원문을 확인하세요" 디스클레이머는 이 데이터가
 * 아니라 프론트 카드가 렌더한다(디스클레이머 문자열은 요약 데이터에 넣지 않음).
 */
export const CLAUSE_SUMMARY_SYSTEM_PROMPT = [
  '당신은 계약 서명자가 원문을 읽기 전에 핵심을 먼저 파악하도록 돕는 계약 요약 도우미예요.',
  '토스 약관 동의 화면처럼, 어려운 계약을 서명자 눈높이에서 짧고 쉽게 풀어 주세요.',
  '',
  '## 지켜야 할 말투',
  '- 해요체로, 담담하고 친절하게 씁니다. 명령형·딱딱한 경고체를 쓰지 않아요.',
  '- 서명자를 탓하거나 겁주지 않아요. 주의가 필요한 내용도 과장 없이 담담히 알려요.',
  '- 계약서에 실제로 있는 내용만 요약해요. 없는 내용을 지어내지 않아요.',
  '- "AI"·"모델"·신뢰도 같은 내부 용어나 처리 과정을 문구에 드러내지 않아요.',
  '- 모든 문구는 한국어로 작성해요.',
  '',
  '## 요약 구조',
  '- oneLiner: 계약 전체를 한 문장으로 압축한 한 줄 요지. 해요체.',
  '- clauses: 서명자에게 중요한 핵심 조항 3~5개를, 가장 주목해야 할 순서대로.',
  '  - headline: 한눈에 이해되는 짧은 구어체 문장. 금액·기간·비율·날짜 같은 핵심',
  '    수치는 그대로 넣어 도드라지게 해요. (예: "위약금은 계약금의 10%예요")',
  '  - detail: 헤드라인을 뒷받침하는 1~2문장 부연 설명. 해요체.',
  '  - category: 조항 분류 라벨(예: 대금, 계약 기간, 책임, 해지, 자동 갱신, 비밀유지).',
  '    미리 정해진 목록이 아니라 조항에 맞는 자유 라벨을 써요.',
  '  - emphasis: 서명자가 특히 주의해야 하는 조항이면 "caution", 일반 정보성',
  '    조항이면 "normal". 위약금·손해배상·책임·자동 갱신·해지 조건·서명자에게',
  '    불리한 의무처럼 주목이 필요한 조항에 "caution"을 씁니다.',
  '  - sourcePage: 그 조항이 나온 원문 페이지 번호(1부터). 아래 "=== 페이지 N ==="',
  '    표시를 근거로 삼되, 확실하지 않으면 생략해요.',
  '',
  '핵심을 먼저 전하고, 정확한 원문 확인은 서명자의 몫으로 남겨요.',
].join('\n');

/**
 * JSON Schema for structured output. Mirrors the shared `ClauseSummary`
 * contract exactly (`packages/db/src/index.ts`). `sourcePage` is optional
 * (omitted when unknown — the reader falls back to a card without an anchor).
 */
export const CLAUSE_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['oneLiner', 'clauses'],
  properties: {
    oneLiner: { type: 'string' },
    clauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'detail', 'category', 'emphasis'],
        properties: {
          headline: { type: 'string' },
          detail: { type: 'string' },
          category: { type: 'string' },
          emphasis: { type: 'string', enum: ['normal', 'caution'] },
          sourcePage: { type: 'integer' },
        },
      },
    },
  },
} as const;

/** Assemble the page-delimited contract body handed to the model. */
export function buildDocumentBody(
  pages: string[],
  maxChars: number = MAX_INPUT_CHARS,
): { body: string; truncated: boolean } {
  let body = '';
  let truncated = false;

  for (let i = 0; i < pages.length; i++) {
    const marker = `\n=== 페이지 ${i + 1} ===\n`;
    const pageText = (pages[i] ?? '').trim();
    const remaining = maxChars - body.length - marker.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (pageText.length > remaining) {
      body += marker + pageText.slice(0, remaining);
      truncated = true;
      break;
    }
    body += marker + pageText;
  }

  return { body: body.trim(), truncated };
}

/** True when the extracted pages carry any usable text (vs. a scanned image PDF). */
export function hasExtractableText(pages: string[]): boolean {
  return pages.some((p) => typeof p === 'string' && p.trim().length > 0);
}

/** Build the user turn: the (possibly truncated) page-delimited contract text. */
export function buildUserPrompt(body: string, truncated: boolean): string {
  const header = truncated
    ? '아래는 계약서 원문의 앞부분이에요(분량이 길어 뒷부분은 생략됐어요). 담긴 범위 안에서 핵심 조항을 요약해 주세요.'
    : '아래는 계약서 원문이에요. 핵심 조항을 요약해 주세요.';
  return `${header}\n\n${body}`;
}

/**
 * Parse + validate the model's JSON into the `ClauseSummary` contract.
 * Returns `null` when the payload is missing/malformed or yields no usable
 * clause — the caller treats `null` as "no summary" (graceful fallback), never
 * writing a partial/garbage summary.
 */
export function normalizeClauseSummary(raw: string | undefined | null): ClauseSummary | null {
  if (!raw) return null;

  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  const oneLiner = typeof record.oneLiner === 'string' ? record.oneLiner.trim() : '';
  if (!oneLiner) return null;

  const rawClauses = Array.isArray(record.clauses) ? record.clauses : [];
  const clauses: ClauseSummaryClause[] = [];
  for (const entry of rawClauses) {
    if (clauses.length >= MAX_CLAUSES) break;
    const clause = normalizeClause(entry);
    if (clause) clauses.push(clause);
  }

  if (clauses.length === 0) return null;

  return { oneLiner, clauses };
}

function normalizeClause(entry: unknown): ClauseSummaryClause | null {
  if (!entry || typeof entry !== 'object') return null;
  const c = entry as Record<string, unknown>;

  const headline = typeof c.headline === 'string' ? c.headline.trim() : '';
  const detail = typeof c.detail === 'string' ? c.detail.trim() : '';
  const category = typeof c.category === 'string' ? c.category.trim() : '';
  if (!headline || !detail || !category) return null;

  const emphasis: ClauseEmphasis = VALID_EMPHASIS.has(c.emphasis as ClauseEmphasis)
    ? (c.emphasis as ClauseEmphasis)
    : 'normal';

  const clause: ClauseSummaryClause = { headline, detail, category, emphasis };

  const sourcePage = c.sourcePage;
  if (typeof sourcePage === 'number' && Number.isInteger(sourcePage) && sourcePage >= 1) {
    clause.sourcePage = sourcePage;
  }

  return clause;
}

/** Tolerant JSON parse — strips a ```json fence if the model wrapped its output. */
function safeParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}
