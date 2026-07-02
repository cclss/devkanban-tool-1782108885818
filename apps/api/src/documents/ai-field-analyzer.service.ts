import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ExtractedDocument,
  ExtractedPage,
  ExtractedTextSpan,
} from './document-extraction.service';
import type { NormRect } from '../pdf/field-geometry';

/**
 * The kind of input field a candidate maps to. Mirrors the three field types in
 * scope for automatic placement (서명 / 날짜 / 텍스트 입력).
 */
export type FieldType = 'SIGNATURE' | 'DATE' | 'TEXT';

/**
 * Where a field candidate came from:
 * - `'ai'`: the external Anthropic provider produced it.
 * - `'heuristic'`: the deterministic local stub produced it (provider disabled
 *   or unavailable).
 */
export type FieldAnalysisSource = 'ai' | 'heuristic';

/**
 * One proposed input field, in the **same normalized, bottom-left page space**
 * (0..1 ratios) as an {@link ExtractedTextSpan} and a stored `SignField`. This is
 * a *candidate* only — grain-3 does the final normalization/validation into a
 * `SignField`.
 */
export interface FieldCandidate {
  type: FieldType;
  /** 0-based page index the field sits on. */
  page: number;
  bbox: NormRect;
  /** Model/heuristic confidence in 0..1. */
  confidence: number;
  /** Optional human-readable hint (the label text that triggered the field). */
  label?: string;
}

/** The full analysis: the candidate list plus which path produced it. */
export interface FieldAnalysisResult {
  source: FieldAnalysisSource;
  fields: FieldCandidate[];
}

// --- Heuristic tuning constants --------------------------------------------

/** Keyword → field-type rules for the deterministic stub (case-insensitive). */
const SIGNATURE_KEYWORDS = ['서명', '성명', '싸인', '사인', 'signature', 'sign'];
const DATE_KEYWORDS = ['날짜', '일자', 'date'];
/** A run of underscores / full-width underscores / box-drawing blanks → TEXT. */
const BLANK_RE = /_{3,}|＿{2,}|·{3,}|…{3,}/;

/** Confidence assigned by the deterministic stub, per rule. */
const HEURISTIC_CONFIDENCE: Record<FieldType, number> = {
  SIGNATURE: 0.72,
  DATE: 0.7,
  TEXT: 0.55,
};

/** Default field width (page-relative) placed to the right of a label. */
const LABEL_FIELD_WIDTH: Record<FieldType, number> = {
  SIGNATURE: 0.18,
  DATE: 0.12,
  TEXT: 0.18,
};

/** Horizontal gap between a label and the field placed after it. */
const LABEL_GAP = 0.01;
/** Fallback field height when a span reports a zero-height box. */
const MIN_FIELD_HEIGHT = 0.02;
/** Cap the label text carried on a candidate so it stays a short hint. */
const MAX_LABEL_LEN = 40;

/**
 * Turns a document's extracted per-page text structure into **field
 * candidates** — the placements a downstream editor uses to pre-drop signature,
 * date, and text-input components onto the page.
 *
 * Two paths, chosen at call time and never surfaced as a failure to the caller:
 * - **External AI** (`analyze` → provider): gated behind `ANTHROPIC_API_KEY`.
 *   When a key is present the Anthropic Claude model reads the structure and
 *   proposes fields. Any provider error degrades to the heuristic — it never
 *   throws — following the {@link NotificationsService}/`StorageService`/
 *   `EmailService` fallback policy.
 * - **Deterministic heuristic** (the stub): maps label keywords
 *   (서명/성명 → SIGNATURE, 날짜/일자/date → DATE) and blank runs (밑줄/빈칸/
 *   `________` → TEXT) at their text-span positions. Same input → same output.
 *
 * Boundary: pure structure → candidates. No document-byte loading, storage
 * access, or DB writes.
 */
@Injectable()
export class AiFieldAnalyzerService {
  private readonly logger = new Logger(AiFieldAnalyzerService.name);

  constructor(private readonly config: ConfigService) {}

  /** True when a real provider key is configured (the AI path is possible). */
  get isAiEnabled(): boolean {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY'));
  }

  /**
   * Analyze the extracted structure and return field candidates. Prefers the
   * external AI provider when configured; otherwise (or on any provider error)
   * falls back to the deterministic heuristic. **Never throws.**
   */
  async analyze(doc: ExtractedDocument): Promise<FieldAnalysisResult> {
    if (this.isAiEnabled) {
      try {
        const fields = await this.analyzeWithAi(doc);
        return { source: 'ai', fields };
      } catch (err) {
        this.logger.warn(`AI 필드 분석 실패 — 휴리스틱으로 대체합니다: ${String(err)}`);
      }
    }
    return { source: 'heuristic', fields: this.analyzeHeuristic(doc) };
  }

  // --- Heuristic (deterministic stub) --------------------------------------

  /**
   * Deterministic fallback. Walks pages and spans in document order and emits at
   * most one candidate per span: a keyword match (서명/성명/날짜/일자/date) wins
   * over a blank-run match, so `'서명: ______'` becomes a SIGNATURE field.
   */
  analyzeHeuristic(doc: ExtractedDocument): FieldCandidate[] {
    const fields: FieldCandidate[] = [];
    for (const page of doc.pages) {
      for (const span of page.textSpans) {
        const candidate = this.matchSpan(page, span);
        if (candidate) fields.push(candidate);
      }
    }
    return fields;
  }

  private matchSpan(page: ExtractedPage, span: ExtractedTextSpan): FieldCandidate | null {
    const text = span.text.trim();
    if (!text) return null;
    const lower = text.toLowerCase();

    const keywordType = this.matchKeyword(lower);
    if (keywordType) {
      return {
        type: keywordType,
        page: page.index,
        bbox: fieldToRightOf(span.bbox, LABEL_FIELD_WIDTH[keywordType]),
        confidence: HEURISTIC_CONFIDENCE[keywordType],
        label: truncateLabel(text),
      };
    }

    if (BLANK_RE.test(text)) {
      // The blank run itself is the input area — place the field on the span.
      return {
        type: 'TEXT',
        page: page.index,
        bbox: fieldOnSpan(span.bbox),
        confidence: HEURISTIC_CONFIDENCE.TEXT,
        label: truncateLabel(text),
      };
    }

    return null;
  }

  private matchKeyword(lowerText: string): FieldType | null {
    if (SIGNATURE_KEYWORDS.some((k) => lowerText.includes(k))) return 'SIGNATURE';
    if (DATE_KEYWORDS.some((k) => lowerText.includes(k))) return 'DATE';
    return null;
  }

  // --- External AI provider (env-gated) ------------------------------------

  /**
   * Ask the Anthropic Claude model to propose field candidates from the
   * extracted structure. Uses structured outputs so the response is a validated
   * JSON object; results are re-validated locally before being returned.
   *
   * Throws on any provider/parse failure — {@link analyze} catches and degrades.
   * Kept `protected` so tests can exercise the fallback contract by overriding it.
   */
  protected async analyzeWithAi(doc: ExtractedDocument): Promise<FieldCandidate[]> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');

    // Lazy import so the SDK is only loaded when the AI path is actually used
    // (mirrors the storage/email adapters' on-demand imports).
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: AI_SYSTEM_PROMPT,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: FIELD_ANALYSIS_SCHEMA },
      },
      messages: [{ role: 'user', content: buildAiUserContent(doc) }],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    const raw = parseFieldsJson(text);
    return this.sanitizeCandidates(raw, doc);
  }

  /**
   * Coerce arbitrary (provider- or test-supplied) field objects into valid
   * {@link FieldCandidate}s: clamp boxes into 0..1, drop unknown types / pages
   * outside the document / non-finite coordinates. Shared safety net for the AI
   * path so a malformed model response can never leak an invalid candidate.
   */
  private sanitizeCandidates(raw: unknown[], doc: ExtractedDocument): FieldCandidate[] {
    const pageCount = doc.pages.length;
    const out: FieldCandidate[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;

      const type = rec.type;
      if (type !== 'SIGNATURE' && type !== 'DATE' && type !== 'TEXT') continue;

      const page = Number(rec.page);
      if (!Number.isInteger(page) || page < 0 || page >= pageCount) continue;

      const bbox = toNormRect(rec.bbox);
      if (!bbox) continue;

      const confidence = clampConfidence(Number(rec.confidence));
      const label = typeof rec.label === 'string' ? truncateLabel(rec.label) : undefined;

      const candidate: FieldCandidate = { type, page, bbox, confidence };
      if (label) candidate.label = label;
      out.push(candidate);
    }
    return out;
  }
}

// --- pure helpers ----------------------------------------------------------

/** Clamp a ratio into the inclusive 0..1 range (0 for non-finite). */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Clamp a confidence into 0..1; default 0.5 when the value is unusable. */
function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return clamp01(v);
}

/** Place a field box to the right of a label span, clamped to the page. */
function fieldToRightOf(label: NormRect, width: number): NormRect {
  const x = clamp01(label.x + label.width + LABEL_GAP);
  const available = clamp01(1 - x);
  const w = Math.min(width, available);
  const height = clamp01(label.height > 0 ? label.height : MIN_FIELD_HEIGHT);
  // No room to the right of the label — fall back to the span's own box.
  if (w < MIN_FIELD_HEIGHT) return fieldOnSpan(label);
  return { x, y: clamp01(label.y), width: w, height };
}

/** Place a field box on top of the span (used for blank-run TEXT fields). */
function fieldOnSpan(span: NormRect): NormRect {
  return {
    x: clamp01(span.x),
    y: clamp01(span.y),
    width: clamp01(span.width),
    height: clamp01(span.height > 0 ? span.height : MIN_FIELD_HEIGHT),
  };
}

/** Trim + cap label text so a candidate carries a short hint, not a paragraph. */
function truncateLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_LEN ? trimmed.slice(0, MAX_LABEL_LEN) : trimmed;
}

/** Validate an unknown value into a {@link NormRect} (clamped), or null. */
function toNormRect(value: unknown): NormRect | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const x = Number(rec.x);
  const y = Number(rec.y);
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: clamp01(x), y: clamp01(y), width: clamp01(width), height: clamp01(height) };
}

/**
 * Extract the `fields` array from the model's JSON response. Tolerates the JSON
 * being wrapped in prose/code fences by falling back to the outermost braces.
 */
function parseFieldsJson(text: string): unknown[] {
  const parsed = tryParseObject(text);
  if (parsed && Array.isArray((parsed as { fields?: unknown }).fields)) {
    return (parsed as { fields: unknown[] }).fields;
  }
  throw new Error('AI 응답에서 필드 배열을 찾을 수 없습니다.');
}

function tryParseObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('AI 응답을 JSON으로 파싱할 수 없습니다.');
  }
}

/** Compact the extracted structure into the payload sent to the model. */
function buildAiUserContent(doc: ExtractedDocument): string {
  const pages = doc.pages.map((page) => ({
    page: page.index,
    spans: page.textSpans.map((span) => ({
      text: span.text,
      bbox: {
        x: round4(span.bbox.x),
        y: round4(span.bbox.y),
        width: round4(span.bbox.width),
        height: round4(span.bbox.height),
      },
    })),
  }));
  return (
    '다음은 문서에서 추출한 페이지별 텍스트 스팬과 그 위치(정규화 0..1, 좌하단 원점)입니다. ' +
    '서명/날짜/텍스트 입력 필드가 필요한 위치를 추정해 JSON으로 반환하세요.\n\n' +
    JSON.stringify({ pages }, null, 0)
  );
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** System prompt for the AI path. */
const AI_SYSTEM_PROMPT =
  '당신은 계약·서식 문서에서 입력 필드를 자동 배치하는 도우미입니다. ' +
  '입력으로 페이지별 텍스트 스팬과 위치가 주어지면, 서명(SIGNATURE)·날짜(DATE)·' +
  '텍스트 입력(TEXT) 필드가 필요한 위치를 추정합니다.\n' +
  '규칙:\n' +
  '- 좌표계는 정규화된 0..1 비율이며 원점은 페이지 좌하단(bottom-left, +y 위쪽)입니다.\n' +
  '- bbox는 필드의 좌하단 모서리(x, y)와 폭·높이(width, height)이며 모두 0..1 범위입니다.\n' +
  '- page는 스팬에 주어진 0-based 페이지 인덱스를 그대로 사용합니다.\n' +
  "- '서명', '성명' 같은 라벨은 SIGNATURE, '날짜', '일자', 'date'는 DATE로 봅니다.\n" +
  '- 밑줄/빈칸(________)처럼 비어 있는 기입란은 TEXT 입력으로 봅니다.\n' +
  '- 라벨 옆(대개 오른쪽)의 빈 공간에 필드를 배치하고, 문서 밖으로 넘어가지 않게 합니다.\n' +
  '- confidence는 0..1 사이 추정 신뢰도입니다. 확실하지 않으면 필드를 만들지 마세요.';

/**
 * JSON schema constraining the model's structured output. Kept free of the
 * numeric/length constraints that structured outputs don't support (clamping is
 * done locally in {@link AiFieldAnalyzerService} instead).
 */
const FIELD_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['SIGNATURE', 'DATE', 'TEXT'] },
          page: { type: 'integer' },
          bbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          confidence: { type: 'number' },
          label: { type: 'string' },
        },
        required: ['type', 'page', 'bbox', 'confidence'],
      },
    },
  },
  required: ['fields'],
} as const;
