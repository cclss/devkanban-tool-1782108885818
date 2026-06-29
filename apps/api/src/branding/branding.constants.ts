/**
 * Brand font catalog — the server-side single source of truth for the fonts an
 * admin may pick for the signer-facing screen (sender branding feature).
 *
 * The admin UI renders this list in a dropdown; the write path validates that a
 * submitted `brandFont` is one of these keys ({@link isBrandFontKey}); the
 * signer screen resolves the selected key back to a real `font-family` stack.
 * Keeping a closed, server-owned catalog is a security/consistency requirement
 * from the spec: only pre-approved, Korean-capable web fonts are allowed — no
 * arbitrary custom font uploads.
 *
 * Scope note: these are *body / UI* fonts for the signer chrome (header,
 * labels, buttons, body text). They are deliberately distinct from the
 * signature-only typefaces (`Nanum Myeongjo` 명조 / `Nanum Pen Script` 손글씨)
 * that the typed-signature feature uses — those render a person's drawn name and
 * are not offered as branding body fonts.
 */

/** How a catalog font is delivered to the browser. */
export interface BrandFontWebfont {
  /**
   * `'system'` — already bundled/loaded by the app (no extra network fetch).
   * `'google'` — loaded from Google Fonts via the `stylesheetUrl`.
   */
  provider: 'system' | 'google';
  /** Web font stylesheet URL to load, or `null` for `'system'` fonts. */
  stylesheetUrl: string | null;
}

/** A selectable brand font. */
export interface BrandFont {
  /** Stable catalog key persisted in `User.brandFont`. */
  key: string;
  /** Korean display label shown in the admin dropdown. */
  label: string;
  /** CSS `font-family` stack (always ends in a Korean-safe generic fallback). */
  fontFamily: string;
  /** Web font loading source. */
  webfont: BrandFontWebfont;
}

/**
 * The catalog. Order is the dropdown order. The first entry
 * ({@link DEFAULT_BRAND_FONT_KEY}) is the app's default body font, so a user who
 * never picks a font still gets a sensible, already-loaded typeface.
 */
export const BRAND_FONTS: readonly BrandFont[] = [
  {
    key: 'pretendard',
    label: '프리텐다드 (기본 고딕)',
    fontFamily:
      "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
    // App default — already loaded site-wide, no Google Fonts fetch needed.
    webfont: { provider: 'system', stylesheetUrl: null },
  },
  {
    key: 'noto-sans-kr',
    label: '노토 산스 (고딕)',
    fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap',
    },
  },
  {
    key: 'nanum-gothic',
    label: '나눔고딕 (고딕)',
    fontFamily: "'Nanum Gothic', 'Apple SD Gothic Neo', sans-serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap',
    },
  },
  {
    key: 'ibm-plex-sans-kr',
    label: 'IBM 플렉스 산스 (고딕)',
    fontFamily: "'IBM Plex Sans KR', 'Apple SD Gothic Neo', sans-serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&display=swap',
    },
  },
  {
    key: 'gowun-dodum',
    label: '고운돋움 (부드러운 고딕)',
    fontFamily: "'Gowun Dodum', 'Apple SD Gothic Neo', sans-serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap',
    },
  },
  {
    key: 'noto-serif-kr',
    label: '노토 세리프 (명조 본문)',
    // A *body* serif, distinct from the signature-only `Nanum Myeongjo`.
    fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;700&display=swap',
    },
  },
] as const;

/** All valid catalog keys, in dropdown order. */
export const BRAND_FONT_KEYS: readonly string[] = BRAND_FONTS.map((f) => f.key);

/** The default font key (app body font), used when a user has not chosen one. */
export const DEFAULT_BRAND_FONT_KEY = BRAND_FONTS[0].key;

const BRAND_FONT_BY_KEY: ReadonlyMap<string, BrandFont> = new Map(
  BRAND_FONTS.map((f) => [f.key, f]),
);

/**
 * Type guard for write-path validation: `true` only when `value` is a known
 * catalog key. Use this to reject arbitrary/unknown font submissions.
 */
export function isBrandFontKey(value: unknown): value is string {
  return typeof value === 'string' && BRAND_FONT_BY_KEY.has(value);
}

/** Resolve a catalog key to its {@link BrandFont}, or `undefined` if unknown. */
export function getBrandFont(key: string): BrandFont | undefined {
  return BRAND_FONT_BY_KEY.get(key);
}
