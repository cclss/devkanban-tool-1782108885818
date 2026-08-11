import {
  MAX_CLAUSES,
  detectCaution,
  extractFigures,
  selectClauses,
  toPlainLanguage,
} from './clause-heuristics';
import type { PageText } from './clause-extraction.types';

/** A realistic single-page lease/service contract with article headers. */
const CONTRACT_PAGE1 = `용역 계약서

제1조 (목적)
이 계약은 갑과 을 사이의 소프트웨어 개발 용역에 관한 사항을 정한다.

제2조 (계약금액)
을에게 지급하는 용역 대금은 금 50,000,000원으로 하며, 계약금 5,000,000원은
착수 시 지급한다.

제3조 (계약기간)
계약기간은 2026년 1월 1일부터 2026년 12월 31일까지 12개월로 한다.

제4조 (지연배상)
을이 납품 기한을 지키지 못한 경우 지연 1일당 대금의 0.1%를 위약금으로 배상한다.`;

function page(text: string, p = 1): PageText {
  return { page: p, text };
}

describe('detectCaution', () => {
  it('flags clauses containing risk keywords', () => {
    expect(detectCaution('지연 1일당 위약금을 배상한다')).toBe(true);
    expect(detectCaution('계약을 해지할 수 있다')).toBe(true);
    expect(detectCaution('손해배상 책임을 진다')).toBe(true);
  });

  it('does not flag neutral clauses', () => {
    expect(detectCaution('이 계약은 용역에 관한 사항을 정한다.')).toBe(false);
    expect(detectCaution('계약기간은 12개월로 한다.')).toBe(false);
  });
});

describe('extractFigures', () => {
  it('pulls money, period and date figures', () => {
    const figures = extractFigures(
      '대금은 50,000,000원이며 기간은 12개월, 시작일은 2026년 1월 1일이다.',
    );
    const kinds = figures.map((f) => f.kind);
    expect(kinds).toContain('money');
    expect(kinds).toContain('period');
    expect(kinds).toContain('date');
  });

  it('captures the money value verbatim', () => {
    const figures = extractFigures('용역 대금은 금 50,000,000원으로 한다.');
    expect(figures.some((f) => f.kind === 'money' && f.value.includes('50,000,000'))).toBe(
      true,
    );
  });

  it('classifies a full date as a date, not a period', () => {
    const figures = extractFigures('만료일은 2026년 12월 31일이다.');
    const date = figures.find((f) => f.value.includes('2026'));
    expect(date?.kind).toBe('date');
    // The "31일" inside the date must not also surface as a standalone period.
    expect(figures.filter((f) => f.kind === 'period')).toHaveLength(0);
  });

  it('returns figures in reading order and de-duplicates', () => {
    const figures = extractFigures('12개월 그리고 다시 12개월');
    expect(figures).toHaveLength(1);
    expect(figures[0]).toEqual({ kind: 'period', value: '12개월' });
  });

  it('returns [] when there are no figures', () => {
    expect(extractFigures('이 계약은 성실히 이행한다.')).toEqual([]);
  });
});

describe('toPlainLanguage', () => {
  it('collapses whitespace and applies plain-language rewrites', () => {
    const out = toPlainLanguage('본  계약은   당사자가\n성실히 이행한다.');
    expect(out).toContain('이 계약');
    expect(out).toContain('계약을 맺는 사람');
    expect(out).not.toMatch(/\s{2,}/);
  });

  it('caps overly long bodies', () => {
    const long = '가'.repeat(500);
    const out = toPlainLanguage(long);
    expect(out.length).toBeLessThanOrEqual(161);
  });

  it('is never empty for non-empty input', () => {
    expect(toPlainLanguage('짧은 조항').length).toBeGreaterThan(0);
  });
});

describe('selectClauses', () => {
  it('returns 1–5 structured clauses from a sample contract', () => {
    const clauses = selectClauses([page(CONTRACT_PAGE1)]);
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    expect(clauses.length).toBeLessThanOrEqual(MAX_CLAUSES);
    for (const c of clauses) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.plainText.length).toBeGreaterThan(0);
      expect(typeof c.caution).toBe('boolean');
      expect(c.page).toBe(1);
      expect(Array.isArray(c.figures)).toBe(true);
    }
  });

  it('flags the caution clause and leaves neutral clauses unflagged', () => {
    const clauses = selectClauses([page(CONTRACT_PAGE1)]);
    const delay = clauses.find((c) => c.title.includes('지연배상'));
    expect(delay).toBeDefined();
    expect(delay?.caution).toBe(true);

    const purpose = clauses.find((c) => c.title.includes('목적'));
    if (purpose) expect(purpose.caution).toBe(false);
  });

  it('surfaces key figures on the money/period clauses', () => {
    const clauses = selectClauses([page(CONTRACT_PAGE1)]);
    const amount = clauses.find((c) => c.title.includes('계약금액'));
    expect(amount?.figures.some((f) => f.kind === 'money')).toBe(true);

    const term = clauses.find((c) => c.title.includes('계약기간'));
    expect(term?.figures.some((f) => f.kind === 'period' || f.kind === 'date')).toBe(true);
  });

  it('caps at 5 clauses, keeping the highest-value ones in reading order', () => {
    const many = Array.from({ length: 8 }, (_, i) => {
      const n = i + 1;
      // Give even-numbered articles figures + caution so they outrank the rest.
      const rich =
        n % 2 === 0
          ? `대금 ${n}00,000원을 지연 시 위약금으로 배상한다.`
          : `일반적인 조항 내용 ${n}.`;
      return `제${n}조 (조항${n})\n${rich}`;
    }).join('\n\n');
    const clauses = selectClauses([page(many)]);
    expect(clauses).toHaveLength(MAX_CLAUSES);
    // Result is in reading order (ascending article number).
    const pages = clauses.map((c) => c.page);
    expect([...pages]).toEqual([...pages].sort((a, b) => a - b));
  });

  it('anchors each clause to the page it starts on', () => {
    const clauses = selectClauses([
      page('제1조 (목적)\n첫 페이지 조항.', 1),
      page('제2조 (대금)\n대금은 1,000,000원이다.', 2),
    ]);
    const first = clauses.find((c) => c.title.includes('목적'));
    const second = clauses.find((c) => c.title.includes('대금'));
    expect(first?.page).toBe(1);
    expect(second?.page).toBe(2);
  });

  it('falls back to paragraph blocks when there are no article headers', () => {
    const noHeaders = [
      page('임대료는 월 800,000원으로 한다.\n\n보증금은 10,000,000원이다.'),
    ];
    const clauses = selectClauses(noHeaders);
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    expect(clauses.length).toBeLessThanOrEqual(MAX_CLAUSES);
    expect(clauses.some((c) => c.figures.some((f) => f.kind === 'money'))).toBe(true);
  });

  it('returns [] for empty text', () => {
    expect(selectClauses([page('')])).toEqual([]);
    expect(selectClauses([page('   \n  \t ')])).toEqual([]);
  });

  it('returns [] for no pages', () => {
    expect(selectClauses([])).toEqual([]);
  });
});
