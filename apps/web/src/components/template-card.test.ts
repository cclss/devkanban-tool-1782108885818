import { formatRelative, metaLine, templateCardViewModel } from './template-card';
import { TEMPLATE_ACTIONS_COPY, TEMPLATE_META_COPY } from '@/lib/templates-copy';
import type { TemplateSummary } from '@/lib/templates';

function template(over: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: 'tpl-1',
    name: '표준 근로계약서 템플릿',
    pageCount: 2,
    fieldCount: 3,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    ...over,
  };
}

describe('formatRelative', () => {
  const now = new Date('2026-08-24T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports 방금 전 for under a minute', () => {
    expect(formatRelative(new Date(now - 30_000).toISOString())).toBe('방금 전');
  });

  it('reports N분 전 under an hour', () => {
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe('5분 전');
  });

  it('reports N시간 전 under a day', () => {
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString())).toBe('3시간 전');
  });

  it('reports N일 전 under a week', () => {
    expect(formatRelative(new Date(now - 2 * 86_400_000).toISOString())).toBe('2일 전');
  });

  it('falls back to an absolute YYYY.MM.DD past a week', () => {
    const then = new Date('2026-08-01T00:00:00.000Z');
    expect(formatRelative(then.toISOString())).toBe('2026.08.01');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatRelative('not-a-date')).toBe('');
  });
});

describe('metaLine', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-24T12:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('joins page count, field count, and the relative saved time', () => {
    const t = template({ pageCount: 2, fieldCount: 3, createdAt: '2026-08-24T11:00:00.000Z' });
    expect(metaLine(t)).toBe(
      `${TEMPLATE_META_COPY.pages(2)} · ${TEMPLATE_META_COPY.fields(3)} · 1시간 전 ${TEMPLATE_META_COPY.savedSuffix}`,
    );
  });

  it('omits the saved segment when the date cannot be parsed', () => {
    const t = template({ pageCount: 1, fieldCount: 0, createdAt: 'not-a-date' });
    expect(metaLine(t)).toBe(`${TEMPLATE_META_COPY.pages(1)} · ${TEMPLATE_META_COPY.fields(0)}`);
  });
});

describe('templateCardViewModel', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-24T12:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes the template name through unchanged', () => {
    const t = template({ name: '프리랜서 용역계약서 템플릿' });
    expect(templateCardViewModel(t).name).toBe('프리랜서 용역계약서 템플릿');
  });

  it('derives metaText from metaLine', () => {
    const t = template();
    expect(templateCardViewModel(t).metaText).toBe(metaLine(t));
  });

  it('exposes the "이 템플릿으로 시작" primary action label', () => {
    const t = template();
    expect(templateCardViewModel(t).startLabel).toBe('이 템플릿으로 시작');
    expect(templateCardViewModel(t).startLabel).toBe(TEMPLATE_ACTIONS_COPY.start);
  });
});
