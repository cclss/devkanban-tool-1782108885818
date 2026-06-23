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

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const API_BASE = `${API_ORIGIN}/api`;

/** Neutral fallback when we can't read a server-provided message. */
export const GENERIC_ERROR = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';

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
