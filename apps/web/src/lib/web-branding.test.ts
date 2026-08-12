/**
 * Branding web-client fetch tests.
 *
 * Pins the cache-bypass contract the live `refresh()` path rests on: the client
 * `fetchBranding` must re-fetch `GET /branding` with `cache: 'no-store'` (the
 * same store bypass `fetchBrandingServer` uses for SSR), so a just-saved asset's
 * new `?v=` URL is never masked by an HTTP-cached response. Without this, the
 * provider would keep applying the previous URL and the favicon/header logo
 * wouldn't swap after a save.
 *
 * Runs in the `node` jest environment: `global.fetch` is stubbed, no DOM needed.
 */

import { fetchBranding, fetchBrandingServer } from './web-branding';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchBranding (client refresh path)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('re-fetches GET /branding with cache: no-store', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ logoUrl: null, faviconUrl: null, brandColor: null }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchBranding();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_ORIGIN}/api/branding`);
    expect(init.cache).toBe('no-store');
  });

  it('resolves the new versioned asset URLs from a save into absolute URLs', async () => {
    // Simulate the payload right after a logo save: a fresh `?v=` cache-buster.
    global.fetch = jest.fn(async () =>
      jsonResponse({
        logoUrl: '/api/branding/asset/logo?v=abc123def456',
        faviconUrl: '/api/branding/asset/favicon?v=abc123def456',
        brandColor: '#163AF2',
      }),
    ) as unknown as typeof fetch;

    const branding = await fetchBranding();

    expect(branding.logoUrl).toBe(`${API_ORIGIN}/api/branding/asset/logo?v=abc123def456`);
    expect(branding.faviconUrl).toBe(`${API_ORIGIN}/api/branding/asset/favicon?v=abc123def456`);
    expect(branding.brandColor).toBe('#163AF2');
  });
});

describe('fetchBrandingServer (SSR path, unchanged reference)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('also fetches with cache: no-store — client path now matches it', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ logoUrl: null, faviconUrl: null, brandColor: null }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchBrandingServer();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.cache).toBe('no-store');
  });
});
