import {
  copyForLocale,
  copyKeyDiff,
  hasCopyParity,
  type WidenCopy,
} from './copy-locale';

describe('copy-locale foundation', () => {
  // A miniature catalog that exercises every widened member kind: string leaf,
  // function member, and nested object — the same shapes real `*-copy.ts` use.
  const KO = {
    title: '서명',
    aria: (page: number) => `${page}페이지`,
    sheet: { apply: '적용', close: '닫기' },
  } as const;

  const EN: WidenCopy<typeof KO> = {
    title: 'Sign',
    aria: (page: number) => `Page ${page}`,
    sheet: { apply: 'Apply', close: 'Close' },
  };

  describe('copyForLocale', () => {
    const copyFor = copyForLocale(KO, EN);

    it('returns the Korean base catalog for ko', () => {
      const copy = copyFor('ko');
      expect(copy.title).toBe('서명');
      expect(copy.sheet.apply).toBe('적용');
      expect(copy.aria(2)).toBe('2페이지');
    });

    it('returns the English catalog for en', () => {
      const copy = copyFor('en');
      expect(copy.title).toBe('Sign');
      expect(copy.sheet.close).toBe('Close');
      expect(copy.aria(2)).toBe('Page 2');
    });

    it('widens string literals so branches only need to be assignable', () => {
      // Compile-time proof: a fresh string (not the literal) satisfies WidenCopy.
      const runtimeTitle: string = ['S', 'ign'].join('');
      const en: WidenCopy<typeof KO> = { ...EN, title: runtimeTitle };
      expect(copyForLocale(KO, en)('en').title).toBe('Sign');
    });
  });

  describe('copyKeyDiff / hasCopyParity', () => {
    it('reports parity when key structures match', () => {
      expect(copyKeyDiff(KO, EN)).toEqual([]);
      expect(hasCopyParity(KO, EN)).toBe(true);
    });

    it('flags a key present only in the Korean catalog as missing', () => {
      const partialEn = { title: 'Sign', aria: EN.aria, sheet: { apply: 'Apply' } };
      const diff = copyKeyDiff(KO, partialEn);
      expect(diff).toContainEqual({ path: 'sheet.close', reason: 'missing' });
      expect(hasCopyParity(KO, partialEn)).toBe(false);
    });

    it('flags a key present only in the English catalog as extra', () => {
      const extraEn = { ...EN, sheet: { ...EN.sheet, reset: 'Reset' } };
      const diff = copyKeyDiff(KO, extraEn);
      expect(diff).toContainEqual({ path: 'sheet.reset', reason: 'extra' });
    });

    it('treats functions as opaque leaves, not objects to recurse into', () => {
      expect(copyKeyDiff({ f: (x: number) => x }, { f: (y: number) => y })).toEqual([]);
    });
  });
});
