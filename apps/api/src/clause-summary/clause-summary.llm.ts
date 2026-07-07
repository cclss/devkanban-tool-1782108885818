import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClauseSummary } from '@repo/db';
import {
  CLAUSE_SUMMARY_JSON_SCHEMA,
  CLAUSE_SUMMARY_SYSTEM_PROMPT,
  DEFAULT_CLAUSE_SUMMARY_MODEL,
  buildUserPrompt,
  normalizeClauseSummary,
} from './clause-summary.constants';

/**
 * LLM client that turns extracted contract text into a `ClauseSummary`.
 *
 * Graceful degradation: when no API key is configured (`ANTHROPIC_API_KEY`),
 * `isConfigured` is false and `summarize()` is a no-op returning `null` — the
 * document keeps a `null` summary and the reader falls back to the plain
 * viewer. The Anthropic SDK is loaded via dynamic import so it (and its
 * transitive deps) never load unless a summary is actually generated, mirroring
 * the codebase's lazy-load pattern for optional cloud SDKs.
 *
 * The model is asked for structured JSON matching the shared `ClauseSummary`
 * contract; the response is validated (`normalizeClauseSummary`) so a malformed
 * or refused generation degrades to `null` rather than a partial summary.
 */
@Injectable()
export class ClauseSummaryLlm {
  private readonly logger = new Logger(ClauseSummaryLlm.name);

  constructor(private readonly config: ConfigService) {}

  /** True when an API key is set (real generation is possible). */
  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
  }

  private get model(): string {
    return this.config.get<string>('CLAUSE_SUMMARY_MODEL') || DEFAULT_CLAUSE_SUMMARY_MODEL;
  }

  /**
   * Summarize the page-delimited contract text into a `ClauseSummary`.
   * Returns `null` (never throws) when unconfigured, refused, or malformed.
   */
  async summarize(body: string, truncated: boolean): Promise<ClauseSummary | null> {
    const apiKey = this.apiKey;
    if (!apiKey) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod;
    const client = new Anthropic({ apiKey });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: CLAUSE_SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(body, truncated) }],
      // Constrain the response to the shared ClauseSummary shape.
      output_config: { format: { type: 'json_schema', schema: CLAUSE_SUMMARY_JSON_SCHEMA } },
    });

    if (response?.stop_reason === 'refusal') {
      this.logger.warn('클로즈 요약 생성이 거부됐어요 — 요약 없이 진행해요.');
      return null;
    }

    const text = extractText(response);
    return normalizeClauseSummary(text);
  }
}

/** Concatenate the text blocks of an Anthropic message response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(response: any): string {
  const content = response?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: { type?: string }) => block?.type === 'text')
    .map((block: { text?: string }) => block.text ?? '')
    .join('');
}
