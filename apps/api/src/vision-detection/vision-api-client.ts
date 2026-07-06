import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildVisionRequestBody } from './vision-payload';
import type {
  RawVisionResponse,
  VisionAnalysisInput,
  VisionErrorReason,
} from './vision-detection.types';

/**
 * Port that talks to the external Vision service. Kept behind a token so the
 * detection service can be tested against a fake client, and so a different
 * provider (a real HTTP client vs. a stub) can be bound without touching the
 * normalization logic.
 *
 * An implementation returns the raw, untrusted {@link RawVisionResponse}, or
 * throws {@link VisionApiError} for any failure — the service maps that to a
 * safe {@link import('./vision-detection.types').VisionEngineResult}.
 */
export interface VisionApiClient {
  analyze(input: VisionAnalysisInput): Promise<RawVisionResponse>;
}

/** DI token for the {@link VisionApiClient} binding. */
export const VISION_API_CLIENT = Symbol('VISION_API_CLIENT');

/**
 * A client failure with a reason that maps 1:1 to a `VisionErrorReason`. The
 * `detail` is for logs only — it never contains document content or PII.
 */
export class VisionApiError extends Error {
  constructor(
    readonly reason: VisionErrorReason,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(`vision api ${reason}${detail ? `: ${detail}` : ''}`);
    this.name = 'VisionApiError';
  }
}

/** Minimal HTTP response surface used by the client (subset of `fetch`). */
export interface VisionHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Minimal `fetch`-like function. Declaring our own surface (instead of leaning
 * on DOM/undici globals) keeps typing simple and makes the client trivially
 * mockable in tests without patching a global.
 */
export type VisionFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<VisionHttpResponse>;

/** Optional DI token to inject a `fetch` implementation (defaults to global). */
export const VISION_FETCH = Symbol('VISION_FETCH');

/** Default request deadline when `VISION_API_TIMEOUT_MS` is unset/invalid. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * HTTP client for the external Vision service.
 *
 * Responsibilities scoped to grain-3:
 *  - Build the PII-minimal request body (via {@link buildVisionRequestBody}).
 *  - Enforce a hard timeout with an {@link AbortController}.
 *  - Translate every failure mode into a {@link VisionApiError} the service can
 *    return safely — a missing config (`unavailable`), a deadline hit
 *    (`timeout`), a transport/non-2xx failure (`api-error`), or an unparseable
 *    body (`bad-response`).
 *
 * The engine is disabled-by-default: with no `VISION_API_ENDPOINT` /
 * `VISION_API_KEY` configured it never calls out — it throws `unavailable`, so
 * wiring the module into the app is safe before credentials exist.
 */
@Injectable()
export class HttpVisionApiClient implements VisionApiClient {
  private readonly logger = new Logger(HttpVisionApiClient.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(VISION_FETCH) private readonly fetchImpl?: VisionFetch,
  ) {}

  private get endpoint(): string | undefined {
    return this.config.get<string>('VISION_API_ENDPOINT') || undefined;
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>('VISION_API_KEY') || undefined;
  }

  private get timeoutMs(): number {
    const raw = Number(this.config.get('VISION_API_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  async analyze(input: VisionAnalysisInput): Promise<RawVisionResponse> {
    const endpoint = this.endpoint;
    const apiKey = this.apiKey;
    if (!endpoint || !apiKey) {
      // Engine not configured — do not call out.
      throw new VisionApiError('unavailable', 'VISION_API_ENDPOINT/KEY 미설정');
    }

    const doFetch = this.resolveFetch();
    if (!doFetch) {
      throw new VisionApiError('unavailable', 'fetch 구현을 찾을 수 없음');
    }

    const body = JSON.stringify(buildVisionRequestBody(input));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: VisionHttpResponse;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        throw new VisionApiError('timeout', `${this.timeoutMs}ms 초과`);
      }
      throw new VisionApiError('api-error', errorMessage(err));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new VisionApiError('api-error', `HTTP ${response.status}`, response.status);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new VisionApiError('bad-response', 'JSON 파싱 실패');
    }
    // Structure is validated by the normalizer, not here.
    return json as RawVisionResponse;
  }

  private resolveFetch(): VisionFetch | undefined {
    if (this.fetchImpl) return this.fetchImpl;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    return typeof globalFetch === 'function'
      ? (globalFetch as VisionFetch)
      : undefined;
  }
}

/** True for an abort/timeout error raised by fetch when the signal fires. */
function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
