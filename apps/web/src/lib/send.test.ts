/**
 * Save-layer contract: `saveFields` serializes the *current* field list as a
 * replace-all PUT, with no regard for whether a field was AI-placed or manual.
 *
 * By the time the wizard sends, the `fields` array already reflects every edit
 * (moves/resizes of auto fields included) and every deletion (removed auto
 * fields simply aren't in the array). `saveFields` must faithfully serialize
 * exactly that list — origin-agnostic — so the persisted set matches what the
 * user sees. These tests lock that behavior.
 */

import type { SignFieldDraft } from '@/components/wizard/wizard-context';

// Mock the transport so we can inspect the exact PUT payload without a network.
jest.mock('./api', () => ({ apiFetch: jest.fn() }));

import { apiFetch } from './api';
import { saveFields } from './send';

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function field(id: string, over: Partial<SignFieldDraft> = {}): SignFieldDraft {
  return {
    id,
    type: 'SIGNATURE',
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    recipientIndex: 0,
    ...over,
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({ count: 0 });
});

describe('saveFields — replace-all PUT of the edit-reflected field list', () => {
  it('PUTs to the document fields endpoint', async () => {
    await saveFields('doc-1', [field('a')], 'tok');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = mockApiFetch.mock.calls[0]!;
    expect(path).toBe('/documents/doc-1/fields');
    expect(opts?.method).toBe('PUT');
    expect(opts?.token).toBe('tok');
  });

  it('serializes auto-field moves/resizes and drops deleted auto fields — origin-agnostic', () => {
    // Post-edit list: an auto field moved+resized, a manual field, and a second
    // auto field (auto-2) already deleted so it is absent from the array.
    const current: SignFieldDraft[] = [
      field('auto-1', { type: 'DATE', page: 2, x: 0.55, y: 0.62, width: 0.33, height: 0.09 }),
      field('manual-1', { type: 'TEXT', x: 0.2, y: 0.3, recipientIndex: 1 }),
    ];

    void saveFields('doc-1', current);

    const [, opts] = mockApiFetch.mock.calls[0]!;
    const sent = (opts?.json as { fields: unknown[] }).fields;

    // Exactly the two surviving fields, in order — deleted auto-2 never appears.
    expect(sent).toEqual([
      { type: 'DATE', page: 2, x: 0.55, y: 0.62, width: 0.33, height: 0.09, recipientIndex: 0 },
      { type: 'TEXT', page: 1, x: 0.2, y: 0.3, width: 0.2, height: 0.05, recipientIndex: 1 },
    ]);
    // No client-only id / provenance leaks into the wire payload.
    for (const f of sent as Record<string, unknown>[]) {
      expect('id' in f).toBe(false);
    }
  });

  it('serializes an empty list (all fields, auto or manual, deleted)', () => {
    void saveFields('doc-1', []);
    const [, opts] = mockApiFetch.mock.calls[0]!;
    expect((opts?.json as { fields: unknown[] }).fields).toEqual([]);
  });

  it('defaults an unhomed field to the first recipient', () => {
    void saveFields('doc-1', [field('a', { recipientIndex: undefined })]);
    const [, opts] = mockApiFetch.mock.calls[0]!;
    expect((opts?.json as { fields: Array<{ recipientIndex: number }> }).fields[0]!.recipientIndex).toBe(0);
  });
});
