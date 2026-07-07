/**
 * Unit tests for the clause-summary presentation helpers.
 *
 * These pin the two pure decisions the card UI rests on:
 *   • `splitKeyNumbers` finds amounts/ratios/durations/dates, is lossless, and
 *     never loops on an empty match.
 *   • `clauseTone` maps the closed `emphasis` vocabulary onto neutral/warning
 *     (caution ⇒ warning + mark), never escalating to danger.
 *
 * Runs in the `node` jest environment (no DOM) — the logic is plain string/data.
 */

import { splitKeyNumbers, clauseTone } from './clause-summary';

/** A segment split is lossless iff rejoining reproduces the input. */
function rejoin(text: string): string {
  return splitKeyNumbers(text)
    .map((s) => s.text)
    .join('');
}

/** The runs the helper flagged as key numbers, in order. */
function highlights(text: string): string[] {
  return splitKeyNumbers(text)
    .filter((s) => s.highlight)
    .map((s) => s.text);
}

describe('splitKeyNumbers', () => {
  it('highlights a percentage inside a flowing sentence', () => {
    expect(highlights('위약금은 계약금의 10%예요')).toEqual(['10%']);
  });

  it('highlights an amount with thousands separators and the 원 unit', () => {
    expect(highlights('보증금은 1,000,000원이에요')).toEqual(['1,000,000원']);
  });

  it('highlights durations (개월 / 일 / 년)', () => {
    expect(highlights('계약 기간은 24개월이에요')).toEqual(['24개월']);
    expect(highlights('해지는 30일 전에 알려주세요')).toEqual(['30일']);
    expect(highlights('갱신 주기는 2년이에요')).toEqual(['2년']);
  });

  it('highlights a full Korean date as one run (not just the year)', () => {
    expect(highlights('시작일은 2024년 1월 1일이에요')).toEqual(['2024년 1월 1일']);
  });

  it('highlights a delimited date', () => {
    expect(highlights('만료일 2024-12-31 이후에는 종료돼요')).toEqual(['2024-12-31']);
  });

  it('highlights every key number when there are several', () => {
    expect(highlights('보증금 500만원에 위약금은 10%예요')).toEqual(['500만원', '10%']);
  });

  it('flags nothing when the sentence has no numbers', () => {
    expect(highlights('임대인은 시설을 유지·보수할 책임이 있어요')).toEqual([]);
    // A sentence with no numbers is returned as a single non-highlighted run.
    expect(splitKeyNumbers('숫자가 없어요')).toEqual([
      { text: '숫자가 없어요', highlight: false },
    ]);
  });

  it('is lossless — rejoining the segments reproduces the input', () => {
    for (const s of [
      '위약금은 계약금의 10%예요',
      '보증금 500만원에 위약금은 10%, 기간은 24개월이에요',
      '시작일 2024년 1월 1일부터 2년간 유효해요',
      '숫자가 전혀 없는 문장이에요',
      '',
    ]) {
      expect(rejoin(s)).toBe(s);
    }
  });

  it('returns no segments for an empty string (no empty-match loop)', () => {
    expect(splitKeyNumbers('')).toEqual([]);
  });

  it('is stable across repeated calls (no leaked regex lastIndex)', () => {
    const input = '위약금은 10%예요';
    const first = splitKeyNumbers(input);
    const second = splitKeyNumbers(input);
    expect(second).toEqual(first);
  });
});

describe('clauseTone', () => {
  it('maps caution to the warning tone with the caution mark on', () => {
    const tone = clauseTone('caution');
    expect(tone.tone).toBe('warning');
    expect(tone.caution).toBe(true);
    expect(tone.surfaceClassName).toContain('warning');
    expect(tone.borderClassName).toContain('warning');
  });

  it('maps normal to the neutral tone with no caution mark', () => {
    const tone = clauseTone('normal');
    expect(tone.tone).toBe('neutral');
    expect(tone.caution).toBe(false);
    expect(tone.surfaceClassName).not.toContain('warning');
    expect(tone.borderClassName).not.toContain('warning');
  });

  it('never escalates caution to danger (reserved for the urgency axis)', () => {
    const tone = clauseTone('caution');
    expect(tone.surfaceClassName).not.toContain('danger');
    expect(tone.borderClassName).not.toContain('danger');
  });
});
