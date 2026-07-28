/**
 * Save paths persist confirmed fields only (grain-3).
 *
 * The recommended/confirmed split is enforced at the data layer: both the send
 * path (`saveFields`) and the template path (`createTemplate`) must strip
 * unaccepted auto-place recommendations before building their server payload, so
 * a recommendation can never reach the DB before the user accepts it. These
 * tests capture the outgoing payload via a mocked `apiFetch` and assert only
 * confirmed fields survive.
 */

import { saveFields } from './send';
import { createTemplate } from './templates';
import { apiFetch } from './api';
import type { SignFieldDraft } from '@/components/wizard/wizard-context';

jest.mock('./api', () => ({
  apiFetch: jest.fn(async () => ({ count: 0 })),
  apiDownload: jest.fn(),
}));
jest.mock('./auth', () => ({ getToken: () => 'tok' }));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const manual: SignFieldDraft = {
  id: 'f1', type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.2, height: 0.05, recipientIndex: 0,
};
const accepted: SignFieldDraft = {
  id: 'f2', type: 'DATE', page: 1, x: 0.3, y: 0.4, width: 0.2, height: 0.05, recipientIndex: 0, status: 'confirmed',
};
const rec: SignFieldDraft = {
  id: 'r1', type: 'TEXT', page: 1, x: 0.6, y: 0.7, width: 0.2, height: 0.05, status: 'recommended',
};

beforeEach(() => mockApiFetch.mockClear());

describe('saveFields', () => {
  it('drops recommended fields from the persisted payload', async () => {
    await saveFields('doc_1', [manual, rec, accepted], 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: { type: string }[] };
    expect(body.fields).toHaveLength(2);
    expect(body.fields.map((f) => f.type)).toEqual(['SIGNATURE', 'DATE']);
  });

  it('sends an empty field set when every field is still recommended', async () => {
    await saveFields('doc_1', [rec], 'tok');
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: unknown[] };
    expect(body.fields).toEqual([]);
  });
});

describe('createTemplate', () => {
  it('stores only confirmed fields in the template layout', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 't1' } as never);
    await createTemplate({ name: 'T', storageKey: 'key', fields: [manual, rec] });
    const body = mockApiFetch.mock.calls[0]![1]!.json as { fields: unknown[] };
    expect(body.fields).toHaveLength(1);
  });
});
