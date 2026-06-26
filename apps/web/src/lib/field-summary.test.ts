import { summarizeFields, type SummarizableField } from './field-summary';

const f = (
  type: SummarizableField['type'],
  page: number,
  source?: SummarizableField['source'],
): SummarizableField => ({ type, page, source });

describe('summarizeFields', () => {
  it('returns empty roll-ups for no fields', () => {
    expect(summarizeFields([])).toEqual({
      total: 0,
      provenance: { ai: 0, adjusted: 0 },
      byType: [],
      byPage: [],
    });
  });

  it('counts the total across all fields', () => {
    const fields = [f('SIGNATURE', 1, 'ai'), f('DATE', 1), f('TEXT', 2, 'manual')];
    expect(summarizeFields(fields).total).toBe(3);
  });

  it('splits provenance: source "ai" is kept-as-is, everything else is adjusted', () => {
    const fields = [
      f('SIGNATURE', 1, 'ai'),
      f('SIGNATURE', 1, 'ai'),
      f('DATE', 1, 'manual'),
      f('TEXT', 1), // no source → adjusted/hand-placed
    ];
    expect(summarizeFields(fields).provenance).toEqual({ ai: 2, adjusted: 2 });
  });

  it('provenance buckets always sum to the total', () => {
    const fields = [f('SIGNATURE', 1, 'ai'), f('DATE', 2), f('TEXT', 3, 'manual')];
    const { provenance, total } = summarizeFields(fields);
    expect(provenance.ai + provenance.adjusted).toBe(total);
  });

  it('counts per type in canonical order, dropping zero-count types', () => {
    const fields = [f('TEXT', 1), f('SIGNATURE', 1), f('SIGNATURE', 2)];
    // DATE absent → dropped; SIGNATURE before TEXT (canonical order).
    expect(summarizeFields(fields).byType).toEqual([
      { type: 'SIGNATURE', count: 2 },
      { type: 'TEXT', count: 1 },
    ]);
  });

  it('counts per page ascending, dropping empty pages', () => {
    const fields = [f('SIGNATURE', 3), f('DATE', 1), f('TEXT', 3), f('TEXT', 1)];
    expect(summarizeFields(fields).byPage).toEqual([
      { page: 1, count: 2 },
      { page: 3, count: 2 },
    ]);
  });

  it('is order-independent for the roll-up totals', () => {
    const a = [f('SIGNATURE', 1, 'ai'), f('DATE', 2, 'manual')];
    const b = [f('DATE', 2, 'manual'), f('SIGNATURE', 1, 'ai')];
    expect(summarizeFields(a)).toEqual(summarizeFields(b));
  });
});
