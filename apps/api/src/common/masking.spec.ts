import { maskEmail, maskIp, maskName } from './masking';

describe('maskName', () => {
  it('masks the middle, keeping first and last (voice.md §3)', () => {
    expect(maskName('홍길동')).toBe('홍*동');
    expect(maskName('김철수영')).toBe('김**영');
    expect(maskName('홍길')).toBe('홍*');
    expect(maskName('홍')).toBe('*');
  });

  it('returns a placeholder for empty input', () => {
    expect(maskName(null)).toBe('—');
    expect(maskName('   ')).toBe('—');
  });
});

describe('maskEmail', () => {
  it('keeps the first two local chars and the domain', () => {
    expect(maskEmail('hong.gildong@example.com')).toBe('ho***@example.com');
  });

  it('reveals only the first char for short local parts', () => {
    expect(maskEmail('ab@example.com')).toBe('a***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('handles missing input/domain conservatively', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail('notanemail')).toBe('no***');
  });
});

describe('maskIp', () => {
  it('masks the last IPv4 octet', () => {
    expect(maskIp('203.0.113.42')).toBe('203.0.113.***');
  });

  it('reveals the first three IPv6 hextets', () => {
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3::****');
  });

  it('returns a placeholder for empty input', () => {
    expect(maskIp(null)).toBe('—');
    expect(maskIp('')).toBe('—');
  });
});
