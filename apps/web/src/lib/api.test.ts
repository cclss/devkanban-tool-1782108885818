/**
 * API origin normalization unit tests.
 *
 * `NEXT_PUBLIC_API_URL` points at the server origin; the client appends `/api`
 * once. A deploy value that already carries `/api` (or a trailing slash) would
 * otherwise produce `/api/api` and 404 every signer request. These pin that
 * appending `/api` to the normalized origin lands exactly one `/api`.
 */

import { normalizeApiOrigin } from './api';

describe('normalizeApiOrigin', () => {
  it('leaves a clean origin untouched', () => {
    expect(normalizeApiOrigin('https://api.example.com')).toBe('https://api.example.com');
  });

  it('strips a trailing slash', () => {
    expect(normalizeApiOrigin('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('strips a trailing /api segment', () => {
    expect(normalizeApiOrigin('https://api.example.com/api')).toBe('https://api.example.com');
  });

  it('strips a trailing /api/ (segment + slash)', () => {
    expect(normalizeApiOrigin('https://api.example.com/api/')).toBe('https://api.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeApiOrigin('  https://api.example.com/api  ')).toBe('https://api.example.com');
  });

  it('never yields /api/api once /api is appended', () => {
    for (const raw of [
      'https://h.com',
      'https://h.com/',
      'https://h.com/api',
      'https://h.com/api/',
      'http://localhost:3001',
    ]) {
      const base = `${normalizeApiOrigin(raw)}/api`;
      expect(base.includes('/api/api')).toBe(false);
      expect(base.endsWith('/api')).toBe(true);
    }
  });
});
