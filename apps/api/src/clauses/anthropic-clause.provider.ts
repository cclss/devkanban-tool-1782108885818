import { Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import {
  CAUTION_CATEGORIES,
  type CautionCategory,
  type ClauseExtractionProvider,
  type RawExtractedClause,
} from './clause-extraction.provider';
import type { PdfPageText } from './pdf-text.service';

/** Default model — confirmed via the `claude-api` skill (see messaging.md M8). */
export const DEFAULT_CLAUSE_MODEL = 'claude-opus-4-8';
/** Output token cap: 3–5 small JSON cards fit comfortably under this. */
const MAX_OUTPUT_TOKENS = 4096;
/** Upper bound on page-text characters sent to the model, to bound token cost. */
const MAX_INPUT_CHARS = 48_000;
/** Target number of clause cards. Recorded as the extraction contract (M6). */
const TARGET_MIN_CLAUSES = 3;
const TARGET_MAX_CLAUSES = 5;

export interface AnthropicClauseProviderConfig {
  apiKey: string;
  model?: string;
}

/**
 * Structured-output schema the model must fill. Structured outputs don't support
 * array length or string length constraints, so the count target lives in the
 * prompt, not the schema; the service enforces the hard cap.
 */
const CLAUSE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          sourcePage: { type: 'integer' },
          sourceSnippet: { type: 'string' },
          cautionCategory: {
            type: 'string',
            enum: [...CAUTION_CATEGORIES],
          },
        },
        required: ['title', 'summary', 'sourcePage', 'cautionCategory'],
      },
    },
  },
  required: ['clauses'],
} as const;

/**
 * System prompt. Encodes the summary tone rules and the "advisory / reference
 * only" positioning (decisions M6/M8) and the caution taxonomy (M7). Legal
 * effect stays with the source document; the summary only reminds.
 */
const SYSTEM_PROMPT = [
  '당신은 계약 원문에서 서명자가 먼저 확인하면 좋을 핵심 조항을 골라 카드로 정리하는 도우미예요.',
  '',
  '역할과 위상:',
  `- 계약 원문에서 가장 중요한 조항 ${TARGET_MIN_CLAUSES}~${TARGET_MAX_CLAUSES}개를 골라요.`,
  '- 요약은 원문을 대체하지 않는 참고·리마인드용 보조 수단이에요. 법적 효력은 언제나 원문에 있어요.',
  '- 법률 자문을 하거나 유불리를 단정하지 않아요. 조항이 무엇을 다루는지 중립적으로 알려줘요.',
  '',
  '요약 톤(해요체):',
  '- 정중한 해요체로, 한두 문장으로 간결하게 써요.',
  '- 서명자를 탓하거나 겁주지 않아요. "확인해 주세요"처럼 다음 행동을 부드럽게 안내해요.',
  '- 원문에 없는 내용을 지어내지 않아요. 각 카드는 원문 근거가 있는 조항이어야 해요.',
  '',
  '주의 플래그(cautionCategory) — 아래 taxonomy 중 하나를 골라요:',
  '- AUTO_RENEWAL: 자동 갱신/자동 연장.',
  '- EARLY_TERMINATION_PENALTY: 중도 해지 시 위약금·불이익.',
  '- PAYMENT_OBLIGATION: 비용·대금 지급 의무.',
  '- LIABILITY: 손해배상·책임·면책.',
  '- PERSONAL_DATA: 개인정보 수집·제3자 제공.',
  '- OTHER: 위에 없지만 한 번 더 살펴볼 만한 조항.',
  '- NONE: 특별히 주의를 표시할 필요가 없는 일반 조항.',
  '경계선이면 NONE으로 두고, 확실할 때만 주의 카테고리를 붙여요.',
  '',
  'sourcePage에는 각 조항의 근거가 있는 [p숫자] 페이지 번호를 넣고, sourceSnippet에는 근거가 된 원문 한 구절을 그대로 넣어요.',
  '출력은 지정된 JSON 형식만 반환해요.',
].join('\n');

/** Extract the text a page-tagged prompt is built from, capped for token budget. */
function buildUserContent(pages: PdfPageText[]): string {
  let out = '';
  for (const page of pages) {
    const block = `[p${page.page}]\n${page.text}\n\n`;
    if (out.length + block.length > MAX_INPUT_CHARS) {
      out += block.slice(0, Math.max(0, MAX_INPUT_CHARS - out.length));
      break;
    }
    out += block;
  }
  return out.trim();
}

function isCautionCategory(value: unknown): value is CautionCategory {
  return (
    typeof value === 'string' &&
    (CAUTION_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Parse and structurally validate the model's JSON response into raw clauses.
 * Throws on unparseable JSON or a missing/!array `clauses` field — the service
 * turns any throw into an empty result. Individual malformed items are skipped
 * (best-effort) rather than failing the whole batch.
 *
 * Exported for unit testing without a live API call.
 */
export function parseClauseResponse(text: string): RawExtractedClause[] {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { clauses?: unknown }).clauses)
  ) {
    throw new Error('clause response missing a `clauses` array');
  }

  const items = (parsed as { clauses: unknown[] }).clauses;
  const clauses: RawExtractedClause[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const { title, summary, sourcePage, sourceSnippet, cautionCategory } = rec;
    if (
      typeof title !== 'string' ||
      typeof summary !== 'string' ||
      typeof sourcePage !== 'number' ||
      !Number.isFinite(sourcePage) ||
      !title.trim() ||
      !summary.trim()
    ) {
      continue;
    }
    clauses.push({
      title: title.trim(),
      summary: summary.trim(),
      sourcePage: Math.max(1, Math.trunc(sourcePage)),
      sourceSnippet:
        typeof sourceSnippet === 'string' && sourceSnippet.trim()
          ? sourceSnippet.trim()
          : undefined,
      cautionCategory: isCautionCategory(cautionCategory)
        ? cautionCategory
        : 'NONE',
    });
  }
  return clauses;
}

/**
 * LLM-backed clause extractor. Active only when an API key is configured; the
 * module wires the deterministic stub otherwise.
 *
 * The SDK is dynamically imported (same convention as the S3/BullMQ adapters) so
 * the dependency loads only when this back-end is actually selected. This
 * provider MAY throw (API error, empty/refused response, JSON parse failure) —
 * `ClauseExtractionService` absorbs every failure into an empty result.
 */
@Injectable()
export class AnthropicClauseProvider implements ClauseExtractionProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicClauseProvider.name);
  private readonly model: string;
  private client: Anthropic | null = null;

  constructor(private readonly config: AnthropicClauseProviderConfig) {
    this.model = config.model || DEFAULT_CLAUSE_MODEL;
  }

  async extract(
    pages: PdfPageText[],
    signal: AbortSignal,
  ): Promise<RawExtractedClause[]> {
    const client = await this.getClient();
    const response = await client.messages.create(
      {
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Extraction from supplied text is not deeply reasoning-heavy; keep
        // effort modest to bound send-time latency and cost.
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: CLAUSE_OUTPUT_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(pages) }],
      },
      { signal },
    );

    const text = this.firstText(response);
    if (!text) {
      // Refusal / empty response — treat as a failure so the service records it.
      throw new Error(`empty model response (stop_reason=${response.stop_reason})`);
    }
    return parseClauseResponse(text);
  }

  /** Concatenated text from the response's text blocks (structured JSON lives here). */
  private firstText(response: Anthropic.Message): string {
    return response.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      )
      .map((block) => block.text)
      .join('')
      .trim();
  }

  private async getClient(): Promise<Anthropic> {
    if (this.client) return this.client;
    const { default: AnthropicSdk } = await import('@anthropic-ai/sdk');
    this.client = new AnthropicSdk({ apiKey: this.config.apiKey });
    return this.client;
  }
}
