/**
 * Unit tests for the contract-dispatch data layer.
 *
 * Runs in the DOM-free `node` env, so `fetch` (the transport `apiFetch` uses) is
 * stubbed. Focus: the AI-suggestion mapping (`fetchFieldSuggestions`) and the
 * invariant that client-only markers never reach the server (`saveFields`).
 */

import { fetchFieldSuggestions, saveFields } from './send';
import { ApiError } from './api';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

/** A JSON `fetch` response stub matching what `apiFetch` reads (`ok`, `json`). */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchFieldSuggestions', () => {
  it('maps suggestions to drafts: fresh id, source=auto, geometry preserved', async () => {
    const dto = {
      type: 'SIGNATURE',
      page: 2,
      x: 0.12,
      y: 0.34,
      width: 0.2,
      height: 0.05,
      recipientIndex: 0,
    };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([dto]));

    const drafts = await fetchFieldSuggestions('doc-1', 'tok');

    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.source).toBe('auto');
    expect(d.id).toMatch(/^field-\d+-\d+$/);
    // Normalized geometry + type + recipient carried through verbatim.
    expect(d).toMatchObject({
      type: 'SIGNATURE',
      page: 2,
      x: 0.12,
      y: 0.34,
      width: 0.2,
      height: 0.05,
      recipientIndex: 0,
    });
  });

  it('defaults recipientIndex to the single signer when the DTO omits it', async () => {
    const dto = { type: 'DATE', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([dto]));

    const d = (await fetchFieldSuggestions('doc-1'))[0]!;

    expect(d.recipientIndex).toBe(0);
  });

  it('mints a distinct id per suggestion', async () => {
    const dto = { type: 'TEXT', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([dto, dto, dto]));

    const drafts = await fetchFieldSuggestions('doc-1');

    expect(new Set(drafts.map((d) => d.id)).size).toBe(3);
  });

  it('hits POST on the field-suggestions route', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = fetchMock;

    await fetchFieldSuggestions('doc-42', 'tok');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/documents/doc-42/field-suggestions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns [] for "nothing to suggest" (distinct from a thrown failure)', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([]));

    await expect(fetchFieldSuggestions('doc-1')).resolves.toEqual([]);
  });

  it('throws (not []) on a network failure, so the caller can tell them apart', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('network down'));

    await expect(fetchFieldSuggestions('doc-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('saveFields does not leak client-only markers', () => {
  it('omits the source flag from the persisted payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ count: 1 }));
    global.fetch = fetchMock;

    const field: SignFieldDraft = {
      id: 'field-1-0',
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.05,
      recipientIndex: 0,
      source: 'auto',
    };
    await saveFields('doc-1', [field], 'tok');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.fields[0]).not.toHaveProperty('source');
    expect(body.fields[0]).not.toHaveProperty('id');
    expect(body.fields[0]).toEqual({
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.05,
      recipientIndex: 0,
    });
  });
});
