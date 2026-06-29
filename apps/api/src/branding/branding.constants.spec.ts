import {
  BRAND_FONTS,
  BRAND_FONT_KEYS,
  DEFAULT_BRAND_FONT_KEY,
  getBrandFont,
  isBrandFontKey,
} from './branding.constants';

describe('brand font catalog', () => {
  it('offers at least 4 fonts', () => {
    expect(BRAND_FONTS.length).toBeGreaterThanOrEqual(4);
  });

  it('has unique keys (no duplicates)', () => {
    const keys = BRAND_FONTS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a Korean label, a valid family stack, and a webfont source', () => {
    const hasHangul = /[가-힣]/; // 한글 음절 범위
    for (const font of BRAND_FONTS) {
      expect(font.key).toMatch(/^[a-z0-9-]+$/);
      expect(font.label.trim().length).toBeGreaterThan(0);
      expect(font.label).toMatch(hasHangul);

      // Family stack: non-empty, comma-separated, ends in a generic fallback.
      const families = font.fontFamily.split(',').map((s) => s.trim());
      expect(families.length).toBeGreaterThanOrEqual(2);
      expect(families.every((f) => f.length > 0)).toBe(true);
      expect(families[families.length - 1]).toMatch(/^(sans-serif|serif|cursive|monospace)$/);

      // Web font source is well-formed.
      if (font.webfont.provider === 'system') {
        expect(font.webfont.stylesheetUrl).toBeNull();
      } else {
        expect(font.webfont.provider).toBe('google');
        expect(font.webfont.stylesheetUrl).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
      }
    }
  });

  it('exposes catalog keys consistent with the catalog', () => {
    expect(BRAND_FONT_KEYS).toEqual(BRAND_FONTS.map((f) => f.key));
  });

  it('has a default key that is a real catalog entry', () => {
    expect(isBrandFontKey(DEFAULT_BRAND_FONT_KEY)).toBe(true);
  });
});

describe('isBrandFontKey', () => {
  it('accepts known keys', () => {
    expect(isBrandFontKey('pretendard')).toBe(true);
    expect(isBrandFontKey('noto-sans-kr')).toBe(true);
  });

  it('rejects unknown / malformed values', () => {
    expect(isBrandFontKey('comic-sans')).toBe(false);
    expect(isBrandFontKey('')).toBe(false);
    expect(isBrandFontKey(null)).toBe(false);
    expect(isBrandFontKey(undefined)).toBe(false);
    expect(isBrandFontKey(123)).toBe(false);
  });
});

describe('getBrandFont', () => {
  it('resolves a known key', () => {
    expect(getBrandFont('pretendard')?.label).toContain('프리텐다드');
  });

  it('returns undefined for an unknown key', () => {
    expect(getBrandFont('nope')).toBeUndefined();
  });
});
