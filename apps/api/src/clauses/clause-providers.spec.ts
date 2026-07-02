import { parseClauseResponse } from './anthropic-clause.provider';
import { StubClauseProvider } from './stub-clause.provider';
import type { PdfPageText } from './pdf-text.service';

describe('parseClauseResponse', () => {
  it('parses a valid structured response and normalizes fields', () => {
    const json = JSON.stringify({
      clauses: [
        {
          title: '  자동 갱신  ',
          summary: ' 갱신 조항이에요. ',
          sourcePage: 3.9,
          sourceSnippet: ' 자동으로 갱신 ',
          cautionCategory: 'AUTO_RENEWAL',
        },
      ],
    });

    const clauses = parseClauseResponse(json);

    expect(clauses).toEqual([
      {
        title: '자동 갱신',
        summary: '갱신 조항이에요.',
        sourcePage: 3, // truncated to an integer
        sourceSnippet: '자동으로 갱신',
        cautionCategory: 'AUTO_RENEWAL',
      },
    ]);
  });

  it('coerces an unknown caution category to NONE and drops blank snippets', () => {
    const json = JSON.stringify({
      clauses: [
        {
          title: '기타',
          summary: '요약이에요.',
          sourcePage: 1,
          sourceSnippet: '   ',
          cautionCategory: 'BOGUS_CATEGORY',
        },
      ],
    });

    const [clause] = parseClauseResponse(json);

    expect(clause.cautionCategory).toBe('NONE');
    expect(clause.sourceSnippet).toBeUndefined();
  });

  it('skips structurally invalid items but keeps valid ones', () => {
    const json = JSON.stringify({
      clauses: [
        { title: '', summary: 'x', sourcePage: 1, cautionCategory: 'NONE' }, // blank title
        { title: '유효', summary: '요약', sourcePage: 2, cautionCategory: 'NONE' },
        { title: '누락', sourcePage: 3, cautionCategory: 'NONE' }, // missing summary
      ],
    });

    const clauses = parseClauseResponse(json);

    expect(clauses).toHaveLength(1);
    expect(clauses[0].title).toBe('유효');
  });

  it('throws on unparseable JSON (parse failure → caller returns empty)', () => {
    expect(() => parseClauseResponse('not json {')).toThrow();
  });

  it('throws when the `clauses` array is missing', () => {
    expect(() => parseClauseResponse(JSON.stringify({ items: [] }))).toThrow();
  });
});

describe('StubClauseProvider', () => {
  const provider = new StubClauseProvider();
  const signal = new AbortController().signal;

  it('detects known clause types deterministically and anchors pages/snippets', async () => {
    const pages: PdfPageText[] = [
      { page: 1, text: '제1조 본 계약의 계약 기간은 1년이며 자동 갱신된다.' },
      { page: 2, text: '제4조 대금은 매월 지급한다.\n제7조 개인정보는 제3자 제공될 수 있다.' },
    ];

    const first = await provider.extract(pages, signal);
    const second = await provider.extract(pages, signal);

    expect(second).toEqual(first); // deterministic
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.length).toBeLessThanOrEqual(5);

    const renewal = first.find((c) => c.cautionCategory === 'AUTO_RENEWAL');
    expect(renewal?.sourcePage).toBe(1);
    expect(renewal?.sourceSnippet).toContain('자동 갱신');

    const privacy = first.find((c) => c.cautionCategory === 'PERSONAL_DATA');
    expect(privacy?.sourcePage).toBe(2);
  });

  it('caps output at 5 cards even when more types match', async () => {
    const pages: PdfPageText[] = [
      {
        page: 1,
        text: [
          '자동 갱신된다',
          '중도 해지 시 위약금',
          '대금 지급',
          '손해배상 책임',
          '개인정보 제3자 제공',
          '계약 기간',
          '준거법 및 관할',
        ].join('\n'),
      },
    ];

    const cards = await provider.extract(pages, signal);

    expect(cards).toHaveLength(5);
  });

  it('returns [] when no known clause keywords are present', async () => {
    const cards = await provider.extract(
      [{ page: 1, text: '오늘 날씨가 참 맑고 좋습니다.' }],
      signal,
    );

    expect(cards).toEqual([]);
  });
});
