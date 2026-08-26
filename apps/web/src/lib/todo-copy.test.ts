import {
  filteredEmptyCopy,
  kanbanBoardCopy,
  nextActionCopy,
  pendingSignerLabel,
  summaryCopy,
  urgencyLabel,
  viewSwitcherCopy,
} from './todo-copy';
import {
  getWebTranslationFallbackReport,
  resetWebTranslationFallbackReport,
} from './web-translations';

/** Every string a copy object recursively contains, for empty/parity checks. */
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

describe('urgencyLabel', () => {
  it('resolves badge labels per locale and switches KO→EN', () => {
    expect(urgencyLabel('OVERDUE', 'ko')).toBe('기한 초과');
    expect(urgencyLabel('OVERDUE', 'en')).toBe('Overdue');
    expect(urgencyLabel('DUE_SOON', 'ko')).toBe('마감 임박');
    expect(urgencyLabel('DUE_SOON', 'en')).toBe('Due soon');
  });

  it('renders no label for NORMAL (badge stays empty) in either locale', () => {
    expect(urgencyLabel('NORMAL', 'ko')).toBe('');
    expect(urgencyLabel('NORMAL', 'en')).toBe('');
  });
});

describe('nextActionCopy', () => {
  it('localizes the label and tags the action kind', () => {
    expect(nextActionCopy('SEND_DRAFT', 'ko')).toEqual({ label: '발송하기', kind: 'cta' });
    expect(nextActionCopy('SEND_DRAFT', 'en')).toEqual({ label: 'Send', kind: 'cta' });
    expect(nextActionCopy('AWAITING_SIGN', 'ko')).toEqual({ label: '서명 대기 중', kind: 'status' });
    expect(nextActionCopy('AWAITING_SIGN', 'en')).toEqual({
      label: 'Awaiting signature',
      kind: 'status',
    });
    expect(nextActionCopy('DOWNLOAD', 'en')).toEqual({ label: 'Download', kind: 'cta' });
  });

  it('returns null when there is no next action', () => {
    expect(nextActionCopy(null, 'ko')).toBeNull();
    expect(nextActionCopy(null, 'en')).toBeNull();
  });
});

describe('pendingSignerLabel', () => {
  it('interpolates the {count} placeholder per locale', () => {
    expect(pendingSignerLabel(3, 'ko')).toBe('서명 대기 3명');
    expect(pendingSignerLabel(3, 'en')).toBe('3 awaiting signature');
    // Interpolation is real substitution, not a literal — the count differs.
    expect(pendingSignerLabel(12, 'ko')).toBe('서명 대기 12명');
    expect(pendingSignerLabel(12, 'en')).toBe('12 awaiting signature');
  });

  it('returns null at zero so the line is omitted (no "0 대기" noise)', () => {
    expect(pendingSignerLabel(0, 'ko')).toBeNull();
    expect(pendingSignerLabel(0, 'en')).toBeNull();
  });
});

describe('summaryCopy / filteredEmptyCopy', () => {
  it('localizes summary titles + count unit and switches KO→EN', () => {
    const ko = summaryCopy('ko');
    const en = summaryCopy('en');
    expect(ko.title.OVERDUE).toBe('기한 초과');
    expect(en.title.OVERDUE).toBe('Overdue');
    expect(ko.title.AWAITING).toBe('서명 대기 중');
    expect(en.title.AWAITING).toBe('Awaiting signature');
    expect(ko.countUnit).not.toBe(en.countUnit);
  });

  it('localizes the filtered-empty message and clear action', () => {
    expect(filteredEmptyCopy('ko')).toEqual({ message: '이 조건에 해당하는 계약이 없어요.', clear: '전체 보기' });
    expect(filteredEmptyCopy('en')).toEqual({ message: 'No contracts match this filter.', clear: 'Show all' });
  });
});

describe('viewSwitcherCopy / kanbanBoardCopy', () => {
  it('localizes view-switcher labels per locale', () => {
    const ko = viewSwitcherCopy('ko');
    const en = viewSwitcherCopy('en');
    expect(ko.label.list).toBe('목록');
    expect(en.label.list).toBe('List');
    expect(ko.label.kanban).toBe('칸반');
    expect(en.label.kanban).toBe('Kanban');
    expect(ko.groupLabel).not.toBe(en.groupLabel);
  });

  it('localizes every kanban column header per locale', () => {
    const ko = kanbanBoardCopy('ko');
    const en = kanbanBoardCopy('en');
    expect(ko.columnLabel.IN_PROGRESS).toBe('진행 중');
    expect(en.columnLabel.IN_PROGRESS).toBe('In progress');
    expect(en.columnLabel.CANCELLED).toBe('Cancelled');
    expect(en.emptyColumn.trim().length).toBeGreaterThan(0);
    expect(en.boardLabel).toBe('Kanban board');
  });
});

describe('todo namespace localization guarantees', () => {
  const buildAll = (locale: 'ko' | 'en') => [
    urgencyLabel('OVERDUE', locale),
    urgencyLabel('DUE_SOON', locale),
    nextActionCopy('SEND_DRAFT', locale),
    nextActionCopy('AWAITING_SIGN', locale),
    nextActionCopy('DOWNLOAD', locale),
    pendingSignerLabel(2, locale),
    summaryCopy(locale),
    filteredEmptyCopy(locale),
    viewSwitcherCopy(locale),
    kanbanBoardCopy(locale),
  ];

  it('emits no empty user-facing string in either locale', () => {
    for (const locale of ['ko', 'en'] as const) {
      for (const s of collectStrings(buildAll(locale))) {
        expect(s.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every emitted key with a zero missing-key report in English', () => {
    resetWebTranslationFallbackReport();
    buildAll('en');
    expect(getWebTranslationFallbackReport().missingKeys).toEqual([]);
  });
});
