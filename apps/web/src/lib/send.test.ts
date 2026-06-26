/**
 * Tests for the field-save payload mapping (grain-2 provenance).
 *
 * `saveFields` must forward each field's provenance so the server can persist
 * how the placement came to be: an untouched AI suggestion → source 'AI' with
 * its confidence; a hand-placed or adjusted field → 'MANUAL' with no confidence.
 * The network call itself is mocked — we assert the request body only.
 */

import { saveFields } from './send';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

const apiFetch = jest.fn();
jest.mock('./api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function field(over: Partial<SignFieldDraft> = {}): SignFieldDraft {
  return { id: 'f1', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, ...over };
}

function lastField(): Record<string, unknown> {
  const body = apiFetch.mock.calls[apiFetch.mock.calls.length - 1][1].json as {
    fields: Array<Record<string, unknown>>;
  };
  return body.fields[0]!;
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ count: 1, status: 'READY', statusLabel: '발송 준비 완료', readyToSend: true });
});

describe('saveFields payload', () => {
  it('maps an AI-as-is field to source AI with its confidence', async () => {
    await saveFields('doc-1', [field({ source: 'ai', confidence: 0.91, recipientIndex: 0 })]);
    expect(lastField()).toEqual({
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.08,
      recipientIndex: 0,
      source: 'AI',
      confidence: 0.91,
    });
  });

  it('defaults a field with no source to MANUAL and omits confidence', async () => {
    await saveFields('doc-1', [field()]);
    const f = lastField();
    expect(f.source).toBe('MANUAL');
    expect(f).not.toHaveProperty('confidence');
  });

  it('treats an adjusted (manual) field as MANUAL and drops any confidence', async () => {
    await saveFields('doc-1', [field({ source: 'manual', confidence: 0.5 })]);
    const f = lastField();
    expect(f.source).toBe('MANUAL');
    expect(f).not.toHaveProperty('confidence');
  });

  it('returns the server send-readiness result', async () => {
    const result = await saveFields('doc-1', [field({ source: 'ai', confidence: 0.8 })]);
    expect(result).toEqual({
      count: 1,
      status: 'READY',
      statusLabel: '발송 준비 완료',
      readyToSend: true,
    });
  });
});
