/**
 * Global service branding — the web client for `GET /branding` and the shape the
 * app-wide runtime applies (header logo, browser-tab favicon, brand color).
 *
 * The API (`apps/api/src/branding/branding.controller.ts`) returns asset URLs
 * that are already prefixed with `/api` and versioned (`?v=…`) for cache-busting;
 * they point at the API origin. We resolve them to *absolute* URLs against that
 * origin so they can be used directly as an `<img src>` / `<link rel="icon">`
 * href (fetched by the browser, not through `apiFetch`).
 *
 * Two entry points: {@link fetchBranding} for the browser (client provider live
 * refresh) and {@link fetchBrandingServer} for SSR (no-flash initial paint).
 */

import { API_ORIGIN, ApiError, GENERIC_ERROR, apiFetch } from './api';

/** Public branding payload — mirrors the API's `BrandingResponse`. */
export interface Branding {
  /** Absolute URL of the service logo, or null when unset (→ wordmark). */
  logoUrl: string | null;
  /** Absolute URL of the favicon, or null when unset (→ default icon). */
  faviconUrl: string | null;
  /** Primary brand color as `#rgb`/`#rrggbb`, or null when unset (→ defaults). */
  brandColor: string | null;
}

/** No branding set — defaults hold (wordmark + default icon + default tokens). */
export const EMPTY_BRANDING: Branding = {
  logoUrl: null,
  faviconUrl: null,
  brandColor: null,
};

/**
 * Resolve an API-relative asset path (already carrying the `/api` prefix) to an
 * absolute URL against the API origin. Pass-through for null or already-absolute.
 */
export function resolveAssetUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

function normalize(raw: Branding): Branding {
  return {
    logoUrl: resolveAssetUrl(raw.logoUrl),
    faviconUrl: resolveAssetUrl(raw.faviconUrl),
    brandColor: raw.brandColor ?? null,
  };
}

/**
 * Fetch current branding from the browser. Used by the client provider's
 * `refresh()` so a just-saved logo/favicon/color re-applies immediately.
 */
export async function fetchBranding(): Promise<Branding> {
  const raw = await apiFetch<Branding>('/branding');
  return normalize(raw);
}

/**
 * Fetch current branding on the server for the initial paint (no flash). Never
 * throws — a transient API failure falls back to {@link EMPTY_BRANDING} so the
 * app renders with defaults rather than erroring the whole tree.
 */
export async function fetchBrandingServer(): Promise<Branding> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/branding`, { cache: 'no-store' });
    if (!res.ok) return EMPTY_BRANDING;
    return normalize((await res.json()) as Branding);
  } catch {
    return EMPTY_BRANDING;
  }
}

/** Which branding asset an upload targets — matches the API's serving kinds. */
export type BrandingAssetKind = 'logo' | 'favicon';

/** Pull a single human message out of a Nest error body (string | string[]). */
function messageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}

/**
 * Upload a branding asset (logo/favicon) as multipart to `POST /branding/{kind}`
 * (field name `file`; the file is re-validated server-side — SVG/PNG, ≤1MB).
 * `apiFetch` only speaks JSON, so — like `lib/upload.ts` — this uses `fetch`
 * directly to send `FormData` while keeping the same error contract: the
 * server's Toss-tone copy surfaces verbatim as an {@link ApiError}, with the
 * neutral generic line as the transport-failure fallback.
 */
export async function uploadBrandingAsset(
  kind: BrandingAssetKind,
  file: File,
  token?: string,
): Promise<void> {
  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/branding/${kind}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
  } catch {
    throw new ApiError(GENERIC_ERROR, 0);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(messageFromBody(body) ?? GENERIC_ERROR, res.status);
  }
}

/**
 * Persist the primary brand color via `PATCH /branding` (hex re-validated
 * server-side). Reuses {@link apiFetch} (JSON + bearer), so a rejected color
 * surfaces the server's copy as an {@link ApiError}.
 */
export async function updateBrandColor(brandColor: string, token?: string): Promise<void> {
  await apiFetch<unknown>('/branding', { method: 'PATCH', json: { brandColor }, token });
}
