import { formatSignedAt } from './completion-facts';

describe('formatSignedAt', () => {
  it('renders a valid ISO stamp as a Korean date-time', () => {
    const out = formatSignedAt('2026-07-24T06:20:00Z');
    // TZ-agnostic: assert the Korean date-time shape rather than an exact hour so
    // the test does not depend on the runner's timezone.
    expect(out).toMatch(/2026년\s*7월\s*24일/);
    expect(out).toMatch(/[0-9]{1,2}:[0-9]{2}/);
    expect(out).toMatch(/오전|오후/);
  });

  it('omits the row (returns "") for missing or unparseable input', () => {
    expect(formatSignedAt(null)).toBe('');
    expect(formatSignedAt(undefined)).toBe('');
    expect(formatSignedAt('')).toBe('');
    expect(formatSignedAt('not-a-date')).toBe('');
  });

  it('is deterministic for a given input', () => {
    const iso = '2026-01-01T00:00:00Z';
    expect(formatSignedAt(iso)).toBe(formatSignedAt(iso));
  });
});
