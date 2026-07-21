import {
  COMPLETION_SUMMARY_LIMIT,
  selectCompletionSummary,
} from './completion-summary';
import type { ContractHighlight, HighlightCategory, HighlightTone } from './signing';

function clause(
  id: string,
  category: HighlightCategory,
  tone: HighlightTone = 'default',
): ContractHighlight {
  return {
    id,
    category,
    title: `${id}-title`,
    summary: `${id}-summary`,
    tone,
    source: { page: 1, excerpt: `${id}-excerpt` },
  };
}

describe('selectCompletionSummary', () => {
  it('surfaces caution clauses first, keeping the rest in original order', () => {
    const clauses = [
      clause('a', 'parties'),
      clause('b', 'caution', 'caution'),
      clause('c', 'money'),
      clause('d', 'caution', 'caution'),
    ];
    expect(selectCompletionSummary(clauses).map((c) => c.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('is a stable partition — equal-tone items never reshuffle', () => {
    const clauses = [
      clause('a', 'parties'),
      clause('b', 'money'),
      clause('c', 'term'),
    ];
    expect(selectCompletionSummary(clauses).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('caps the list at the default limit', () => {
    const clauses = Array.from({ length: 7 }, (_, i) => clause(`c${i}`, 'obligation'));
    expect(selectCompletionSummary(clauses)).toHaveLength(COMPLETION_SUMMARY_LIMIT);
  });

  it('honors a custom limit and still puts cautions first', () => {
    const clauses = [
      clause('a', 'parties'),
      clause('b', 'money'),
      clause('c', 'caution', 'caution'),
    ];
    expect(selectCompletionSummary(clauses, 2).map((c) => c.id)).toEqual(['c', 'a']);
  });

  it('returns an empty list for a non-positive limit', () => {
    expect(selectCompletionSummary([clause('a', 'money')], 0)).toEqual([]);
    expect(selectCompletionSummary([clause('a', 'money')], -3)).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(selectCompletionSummary([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const clauses = [
      clause('a', 'parties'),
      clause('b', 'caution', 'caution'),
    ];
    const before = clauses.map((c) => c.id);
    selectCompletionSummary(clauses);
    expect(clauses.map((c) => c.id)).toEqual(before);
  });
});
