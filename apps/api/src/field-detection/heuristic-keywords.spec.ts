import { matchKeyword } from './heuristic-keywords';
import { SignFieldType } from '@repo/db';

describe('matchKeyword', () => {
  it('maps Korean labels to the right field type', () => {
    expect(matchKeyword('서명')?.type).toBe(SignFieldType.SIGNATURE);
    expect(matchKeyword('날짜')?.type).toBe(SignFieldType.DATE);
    expect(matchKeyword('성명')?.type).toBe(SignFieldType.TEXT);
    expect(matchKeyword('주소')?.type).toBe(SignFieldType.TEXT);
    expect(matchKeyword('생년월일')?.type).toBe(SignFieldType.DATE);
  });

  it('maps English labels case-insensitively', () => {
    expect(matchKeyword('Signature')?.type).toBe(SignFieldType.SIGNATURE);
    expect(matchKeyword('DATE')?.type).toBe(SignFieldType.DATE);
    expect(matchKeyword('Name')?.type).toBe(SignFieldType.TEXT);
    expect(matchKeyword('E-mail')?.type).toBe(SignFieldType.TEXT);
  });

  it('returns null for non-label text', () => {
    expect(matchKeyword('계약서')).toBeNull();
    expect(matchKeyword('lorem ipsum')).toBeNull();
    expect(matchKeyword('')).toBeNull();
    expect(matchKeyword('   ')).toBeNull();
  });

  it('does not match "sign" inside an unrelated word', () => {
    // \bsign\b must not fire on "design".
    expect(matchKeyword('design')).toBeNull();
  });

  it('adds a structural bonus for a colon or trailing underline', () => {
    const plain = matchKeyword('서명')!.confidence;
    expect(matchKeyword('서명:')!.confidence).toBeGreaterThan(plain);
    expect(matchKeyword('서명 ____')!.confidence).toBeGreaterThan(plain);
  });

  it('keeps the highest-confidence match when several rules match', () => {
    // "서명일자" matches both 서명 (0.9) and 일자 (0.85) → strongest wins.
    expect(matchKeyword('서명일자')?.type).toBe(SignFieldType.SIGNATURE);
  });

  it('never exceeds a confidence of 1', () => {
    expect(matchKeyword('서명: ____')!.confidence).toBeLessThanOrEqual(1);
  });
});
