import { isKoreanMobile, normalizeKoreanMobile } from './phone';

describe('normalizeKoreanMobile', () => {
  it('strips spaces and hyphens to canonical digits', () => {
    expect(normalizeKoreanMobile('010-1234-5678')).toBe('01012345678');
    expect(normalizeKoreanMobile('010 1234 5678')).toBe('01012345678');
  });

  it('rewrites +82 / 82 international prefixes to a leading 0', () => {
    expect(normalizeKoreanMobile('+82 10-1234-5678')).toBe('01012345678');
    expect(normalizeKoreanMobile('82-10-1234-5678')).toBe('01012345678');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeKoreanMobile('')).toBe('');
    expect(normalizeKoreanMobile('---')).toBe('');
  });
});

describe('isKoreanMobile', () => {
  it('accepts valid Korean mobile numbers in any common format', () => {
    expect(isKoreanMobile('010-1234-5678')).toBe(true);
    expect(isKoreanMobile('+82 10 1234 5678')).toBe(true);
    expect(isKoreanMobile('01112345678')).toBe(true);
  });

  it('rejects non-mobile or malformed numbers', () => {
    expect(isKoreanMobile('02-123-4567')).toBe(false); // landline
    expect(isKoreanMobile('010-1234')).toBe(false); // too short
    expect(isKoreanMobile('abcd')).toBe(false);
  });
});
