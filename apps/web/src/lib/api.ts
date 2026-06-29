/**
 * Browser-side API client.
 *
 * The NestJS server mounts every route under the `/api` prefix (see
 * `apps/api/src/main.ts`). `NEXT_PUBLIC_API_URL` points at the server origin;
 * we append `/api` here so callers pass clean paths like `/auth/login`.
 *
 * User-facing error copy comes from the server (`apps/api/src/common/messages.ts`),
 * so we surface the server's message verbatim and only fall back to a neutral,
 * Toss-tone Korean line when the network itself fails or the body is unreadable.
 */

/**
 * Server origin (no `/api` suffix). Exported so callers can resolve an
 * already-prefixed server path — e.g. a `brandLogoUrl` of `/api/branding/...`
 * returned by the API — to an absolute URL that works cross-origin in dev.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const API_BASE = `${API_ORIGIN}/api`;

/** Neutral fallback when we can't read a server-provided message. */
export const GENERIC_ERROR = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';

/**
 * Absolute URL for an API path. Use when fetching outside `apiFetch` — e.g. a
 * binary stream (PDF bytes) that isn't JSON — so the `/api` prefix stays in one
 * place.
 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Pull a single human message out of a Nest error body (string | string[]). */
function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.length > 0 && typeof message[0] === 'string') {
    return message[0];
  }
  return null;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serializable request body. */
  json?: unknown;
  /** Bearer token for authenticated calls. */
  token?: string;
}

/**
 * Fetch a binary response (e.g. a PDF download) as a Blob, surfacing the
 * server's Toss-tone error copy on failure just like {@link apiFetch}. The
 * server sends the filename via `Content-Disposition`; callers that already know
 * a good name (e.g. from the contract title) can ignore the returned one.
 */
export async function apiDownload(
  path: string,
  options: ApiRequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const { token, headers, ...rest } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(GENERIC_ERROR, 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(extractMessage(body) ?? GENERIC_ERROR, res.status);
  }

  const blob = await res.blob();
  return { blob, filename: filenameFromDisposition(res.headers.get('Content-Disposition')) };
}

/** Pull the UTF-8 `filename*` (or plain `filename`) out of a disposition header. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // Malformed encoding — fall through to the plain filename.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { json, token, headers, ...rest } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    // Network / CORS / server-down — never expose the raw error.
    throw new ApiError(GENERIC_ERROR, 0);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(extractMessage(body) ?? GENERIC_ERROR, res.status);
  }

  return body as T;
}
