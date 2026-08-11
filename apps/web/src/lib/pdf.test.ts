/**
 * Unit tests for the PDF loader's session-expiry surfacing.
 *
 * The signer viewer's re-auth routing on the *reading* path (M-2) hinges on one
 * fact: a session-guarded PDF stream that 401s must carry that status out of
 * `loadPdfFromUrl` so the viewer can tell a lapsed session apart from a corrupt
 * file. Historically the loader swallowed the HTTP status (every `!res.ok`
 * became a bare `PdfRenderError`), so the 401 was invisible and the viewer only
 * ever showed the generic load error. These tests pin the status surfacing and
 * the pure `isPdfSessionExpired` predicate the viewer consumes.
 *
 * Only the `!res.ok` path is exercised: it rejects before any `pdfjs-dist`
 * (browser-only) code runs, so a mocked `fetch` is enough — no jsdom, no worker.
 */

import { PdfRenderError, isPdfSessionExpired, loadPdfFromUrl } from './pdf';

describe('loadPdfFromUrl — HTTP status surfacing', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(response: Partial<Response> & { ok: boolean; status: number }): void {
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
  }

  it('surfaces a 401 (lapsed session) as PdfRenderError.status', async () => {
    mockFetch({ ok: false, status: 401 });
    const err = await loadPdfFromUrl('https://api.example/pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfRenderError);
    expect((err as PdfRenderError).status).toBe(401);
  });

  it('surfaces other non-ok statuses too (not misread as expiry)', async () => {
    mockFetch({ ok: false, status: 500 });
    const err = await loadPdfFromUrl('https://api.example/pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfRenderError);
    expect((err as PdfRenderError).status).toBe(500);
  });

  it('has no status when the fetch itself throws (network/parse failure)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('network down')) as unknown as typeof fetch;
    const err = await loadPdfFromUrl('https://api.example/pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfRenderError);
    expect((err as PdfRenderError).status).toBeUndefined();
  });
});

describe('isPdfSessionExpired', () => {
  it('is true only for a 401 PdfRenderError', () => {
    expect(isPdfSessionExpired(new PdfRenderError(undefined, 401))).toBe(true);
  });

  it('is false for other PdfRenderError statuses (or none)', () => {
    expect(isPdfSessionExpired(new PdfRenderError(undefined, 403))).toBe(false);
    expect(isPdfSessionExpired(new PdfRenderError(undefined, 500))).toBe(false);
    expect(isPdfSessionExpired(new PdfRenderError())).toBe(false);
  });

  it('is false for non-PdfRenderError values', () => {
    expect(isPdfSessionExpired(new Error('boom'))).toBe(false);
    expect(isPdfSessionExpired({ status: 401 })).toBe(false);
    expect(isPdfSessionExpired(null)).toBe(false);
    expect(isPdfSessionExpired(undefined)).toBe(false);
  });
});
