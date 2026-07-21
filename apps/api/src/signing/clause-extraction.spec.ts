import {
  extractHighlights,
  translateLegalTerms,
  splitSentences,
  collapseWhitespace,
  LEGAL_GLOSSARY,
  MAX_HIGHLIGHTS,
  type PageText,
} from './clause-extraction';

/** A representative Korean service contract with all five clause categories. */
const CONTRACT: PageText[] = [
  {
    page: 1,
    text: `용역 계약서
주식회사 아크메(이하 '갑')와 김철수(이하 '을')는 다음과 같이 계약을 체결한다.
제1조 (계약 금액) 갑은 을에게 용역 대금으로 금 5,000,000원을 지급한다.
제2조 (계약 기간) 본 계약의 기간은 2026년 1월 1일부터 12개월간으로 한다.`,
  },
  {
    page: 2,
    text: `제3조 (의무) 을은 매월 말일까지 결과물을 제출하여야 한다.
제4조 (지연) 을의 귀책사유로 납품이 늦어질 경우 지체상금을 지급한다.
제5조 (해지) 갑은 을이 의무를 위반하면 계약을 해지할 수 있다.`,
  },
];

describe('collapseWhitespace', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(collapseWhitespace('  a\n\t b   c ')).toBe('a b c');
  });
});

describe('splitSentences', () => {
  it('splits into non-trivial sentences carrying their page number', () => {
    const sentences = splitSentences(CONTRACT);
    expect(sentences.length).toBeGreaterThan(4);
    expect(sentences.every((s) => s.text.length >= 2)).toBe(true);
    // Page 2 content keeps page 2.
    expect(sentences.some((s) => s.page === 2 && s.text.includes('지체상금'))).toBe(
      true,
    );
  });

  it('returns nothing for whitespace-only pages', () => {
    expect(splitSentences([{ page: 1, text: '   \n\n ' }])).toEqual([]);
  });
});

describe('translateLegalTerms', () => {
  it('appends an everyday gloss the first time a legal term appears', () => {
    const out = translateLegalTerms('계약을 해지할 수 있다.');
    expect(out).toContain(`해지(${LEGAL_GLOSSARY['해지']})`);
  });

  it('glosses "자동 갱신" as a whole, not the "갱신" substring', () => {
    const out = translateLegalTerms('본 계약은 자동 갱신된다.');
    expect(out).toContain('자동 갱신(');
    expect(out).not.toContain('자동 갱신(계약 기간을 이어가는 것)');
  });

  it('does not annotate every grammatical "을" particle', () => {
    const out = translateLegalTerms('결과물을 제출한다.');
    expect(out).toBe('결과물을 제출한다.');
  });

  it('glosses "을" when it stands alone as a party marker', () => {
    const out = translateLegalTerms("'을' 은 성실히 이행한다.");
    expect(out).toContain(`을(${LEGAL_GLOSSARY['을']})`);
  });
});

describe('extractHighlights', () => {
  it('returns 3–5 cards for a normal contract', () => {
    const cards = extractHighlights(CONTRACT);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(MAX_HIGHLIGHTS);
  });

  it('covers the key categories in reading-priority order', () => {
    const cards = extractHighlights(CONTRACT);
    const cats = cards.map((c) => c.category);
    expect(cats).toContain('parties');
    expect(cats).toContain('money');
    expect(cats).toContain('term');
    expect(cats).toContain('caution');
    // parties precedes money precedes term.
    expect(cats.indexOf('parties')).toBeLessThan(cats.indexOf('money'));
    expect(cats.indexOf('money')).toBeLessThan(cats.indexOf('term'));
  });

  it('captures the concrete amount in the money card', () => {
    const money = extractHighlights(CONTRACT).find((c) => c.category === 'money');
    expect(money).toBeDefined();
    expect(money!.summary).toContain('5,000,000원');
  });

  it('flags caution clauses with a distinct tone and glossed explanation', () => {
    const caution = extractHighlights(CONTRACT).find(
      (c) => c.category === 'caution',
    );
    expect(caution).toBeDefined();
    expect(caution!.tone).toBe('caution');
    // Highest-priority risky term present here is 지체상금.
    expect(caution!.summary).toContain('지체상금');
    expect(caution!.summary).toContain(LEGAL_GLOSSARY['지체상금']);
  });

  it('all non-caution cards use the default tone', () => {
    const cards = extractHighlights(CONTRACT);
    for (const c of cards) {
      if (c.category !== 'caution') expect(c.tone).toBe('default');
    }
  });

  it('anchors every card to a source page + excerpt for the 원문 jump', () => {
    for (const c of extractHighlights(CONTRACT)) {
      expect(c.source.page).toBeGreaterThanOrEqual(1);
      expect(c.source.excerpt.length).toBeGreaterThan(0);
    }
  });

  it('gives each card a stable, unique id', () => {
    const ids = extractHighlights(CONTRACT).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns no cards when there is no extractable text', () => {
    expect(extractHighlights([])).toEqual([]);
    expect(extractHighlights([{ page: 1, text: '   ' }])).toEqual([]);
  });

  it('is deterministic', () => {
    expect(extractHighlights(CONTRACT)).toEqual(extractHighlights(CONTRACT));
  });
});
