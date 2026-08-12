/**
 * Reservation-management API client unit tests.
 *
 * Pins the request contract (method / path / body) of the two schedule-management
 * wrappers so a wrong verb, a renamed route, or a dropped/renamed body key is
 * caught here instead of in the browser:
 *   • rescheduleContract → PATCH  /documents/:id/schedule  with { scheduledSendAt }
 *   • cancelSchedule     → DELETE /documents/:id/schedule  with no body
 *
 * `apiFetch` is mocked — these tests are about the request we *send*, not the
 * network — and the id is asserted URL-encoded so an odd id can't break the path
 * or smuggle extra path segments.
 */

import { cancelSchedule, rescheduleContract } from './documents';
import { apiFetch } from './api';

jest.mock('./api', () => ({
  apiFetch: jest.fn(),
}));

const mockApiFetch = apiFetch as unknown as jest.Mock;

const INSTANT = '2026-08-20T05:00:00.000Z';

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe('rescheduleContract', () => {
  it('PATCHes /documents/:id/schedule with the new instant in the body', async () => {
    const summary = { id: 'doc-1', status: 'SCHEDULED' };
    mockApiFetch.mockResolvedValue(summary);

    const result = await rescheduleContract('doc-1', INSTANT);

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/documents/doc-1/schedule');
    expect(options).toMatchObject({
      method: 'PATCH',
      json: { scheduledSendAt: INSTANT },
    });
    expect(result).toBe(summary);
  });

  it('URL-encodes the document id in the path', async () => {
    mockApiFetch.mockResolvedValue({});
    await rescheduleContract('a/b?c', INSTANT);
    expect(mockApiFetch.mock.calls[0][0]).toBe('/documents/a%2Fb%3Fc/schedule');
  });
});

describe('cancelSchedule', () => {
  it('DELETEs /documents/:id/schedule with no request body', async () => {
    const summary = { id: 'doc-1', status: 'DRAFT' };
    mockApiFetch.mockResolvedValue(summary);

    const result = await cancelSchedule('doc-1');

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/documents/doc-1/schedule');
    expect(options.method).toBe('DELETE');
    expect(options.json).toBeUndefined();
    expect(result).toBe(summary);
  });

  it('URL-encodes the document id in the path', async () => {
    mockApiFetch.mockResolvedValue({});
    await cancelSchedule('a/b?c');
    expect(mockApiFetch.mock.calls[0][0]).toBe('/documents/a%2Fb%3Fc/schedule');
  });
});
