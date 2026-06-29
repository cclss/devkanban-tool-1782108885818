/**
 * Sender branding — the single client module for the admin branding-settings
 * surface and the signer re-skin bridge.
 *
 * It owns four things:
 *  1. {@link brandStyle} — expands a sender's stored brand color (and, now, font)
 *     into the `--brand-*` CSS custom properties the design system inherits from,
 *     so an entire subtree re-skins by setting these vars on one wrapping element.
 *  2. {@link BRAND_FONT_CATALOG} — a client mirror of the server's closed brand
 *     font catalog (`apps/api/src/branding/branding.constants.ts`), used to keep
 *     `brandStyle()` synchronous (key → family stack) and to lazy-load the web
 *     font a preview/signer screen needs.
 *  3. AA contrast helpers — warn when a chosen brand color is hard to read on the
 *     white signer surface.
 *  4. The authenticated write/read API client for the branding endpoints
 *     (grain-2: `GET/PUT /branding`, `POST/DELETE /branding/logo`).
 *
 * The brand color/font a user picks are *runtime data*, not design tokens; the
 * catalog mirrors the family tokens already registered in the design system.
 */

import type * as React from 'react';
import { ApiError, API_ORIGIN, GENERIC_ERROR, apiFetch } from './api';
import { getToken } from './auth';

// ---------------------------------------------------------------------------
// brand color/font → CSS custom property bridge
// ---------------------------------------------------------------------------

/** CSS custom properties are not in the typed `CSSProperties` surface. */
type BrandStyle = React.CSSProperties & Record<`--${string}`, string>;

/** Accepts `#rgb` / `#rrggbb` only; anything else is ignored (sender-supplied). */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Whether a string is a syntactically valid brand hex color. */
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value.trim());
}

/**
 * Build the inline style that re-skins the brand hook.
 *
 * - `brandColor` (valid hex) sets `--brand-primary` + its hover/pressed/subtle
 *   companions (derived with `color-mix`, mirroring the default ramp).
 * - `brandFont` (a catalog key) sets `--brand-font` to the resolved family
 *   stack so a subtree can apply `font-family: var(--brand-font)`.
 *
 * Returns only the vars that are valid, so absent/invalid inputs leave the
 * default tokens in force. Backward compatible with the single-arg signer call.
 */
export function brandStyle(
  brandColor: string | null | undefined,
  brandFont?: string | null,
): BrandStyle {
  const style: BrandStyle = {};

  if (isHexColor(brandColor)) {
    const base = brandColor.trim();
    style['--brand-primary'] = base;
    // Darken for the hover/pressed states; lighten for the subtle wash. Ratios
    // echo the default ramp's spacing between primary and its companions.
    style['--brand-primary-hover'] = `color-mix(in srgb, ${base} 88%, #000)`;
    style['--brand-primary-pressed'] = `color-mix(in srgb, ${base} 76%, #000)`;
    style['--brand-primary-subtle'] = `color-mix(in srgb, ${base} 12%, #fff)`;
  }

  if (brandFont) {
    style['--brand-font'] = resolveBrandFontFamily(brandFont);
  }

  return style;
}

// ---------------------------------------------------------------------------
// brand font catalog (client mirror of the server single source of truth)
// ---------------------------------------------------------------------------

/** How a catalog font reaches the browser. */
export interface BrandFontWebfont {
  /** `'system'` — already loaded site-wide; `'google'` — fetched via `stylesheetUrl`. */
  provider: 'system' | 'google';
  /** Stylesheet URL to load for `'google'` fonts, else `null`. */
  stylesheetUrl: string | null;
}

/** A selectable brand font (mirror of the server `BrandFont`). */
export interface BrandFont {
  /** Stable catalog key persisted in `User.brandFont`. */
  key: string;
  /** Korean display label shown in the dropdown. */
  label: string;
  /** CSS `font-family` stack (always ends in a Korean-safe fallback). */
  fontFamily: string;
  /** Web font loading source. */
  webfont: BrandFontWebfont;
}

/**
 * The catalog, mirroring `apps/api/src/branding/branding.constants.ts`
 * (`BRAND_FONTS`) and the typography `family-*` tokens. The server stays the
 * source of truth and returns its own list on `GET /branding`; this mirror lets
 * `brandStyle()` resolve a key synchronously and the preview pre-load fonts. The
 * first entry is the app default body font (already loaded site-wide).
 */
export const BRAND_FONT_CATALOG = [
  {
    key: 'pretendard',
    label: '프리텐다드 (기본 고딕)',
    fontFamily:
      "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
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
      stylesheetUrl: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap',
    },
  },
  {
    key: 'noto-serif-kr',
    label: '노토 세리프 (명조 본문)',
    fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', serif",
    webfont: {
      provider: 'google',
      stylesheetUrl:
        'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;700&display=swap',
    },
  },
] as const satisfies readonly BrandFont[];

/** Default font key (app body font) used when a user has not chosen one. */
export const DEFAULT_BRAND_FONT_KEY = BRAND_FONT_CATALOG[0].key;

const BRAND_FONT_BY_KEY: ReadonlyMap<string, BrandFont> = new Map(
  BRAND_FONT_CATALOG.map((f) => [f.key, f]),
);

/** Resolve a catalog key to its font, falling back to the default entry. */
export function getBrandFont(key: string | null | undefined): BrandFont {
  return (key ? BRAND_FONT_BY_KEY.get(key) : undefined) ?? BRAND_FONT_CATALOG[0];
}

/** Resolve a catalog key to its CSS `font-family` stack. */
export function resolveBrandFontFamily(key: string | null | undefined): string {
  return getBrandFont(key).fontFamily;
}

/**
 * Lazily inject the stylesheet a (non-system) catalog font needs, idempotently.
 * No-op on the server, for `'system'` fonts, or when already injected. Lets the
 * live preview render text in a brand font the page hasn't otherwise loaded.
 */
export function ensureBrandFontLoaded(key: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const font = getBrandFont(key);
  const href = font.webfont.stylesheetUrl;
  if (font.webfont.provider !== 'google' || !href) return;
  const id = `brand-font-${font.key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// ---------------------------------------------------------------------------
// AA contrast — warn when a brand color is hard to read on the white surface
// ---------------------------------------------------------------------------

/** WCAG AA minimum contrast for normal-size text (brand text/links on white). */
export const AA_CONTRAST_MIN = 4.5;

/** Parse `#rgb` / `#rrggbb` to 0–255 channels, or null when not a hex color. */
function parseHex(hex: string): [number, number, number] | null {
  if (!isHexColor(hex)) return null;
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Relative luminance (WCAG) of an sRGB channel triple. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio (1–21) of a brand hex color against white, or null if invalid. */
export function contrastOnWhite(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const lum = relativeLuminance(rgb);
  // White luminance is 1; ratio = (lighter + 0.05) / (darker + 0.05).
  return (1 + 0.05) / (lum + 0.05);
}

/**
 * Whether a (valid) brand color fails AA against the white signer surface, i.e.
 * brand-colored text/links would be hard to read. Invalid/empty input is not a
 * "low contrast" warning (the format error covers it), so returns false.
 */
export function isLowContrastOnWhite(hex: string | null | undefined): boolean {
  if (!isHexColor(hex)) return false;
  const ratio = contrastOnWhite(hex);
  return ratio !== null && ratio < AA_CONTRAST_MIN;
}

/**
 * Preset brand-color swatches offered in the picker. These are candidate *data*
 * values a user may choose (not design tokens): a small, pleasant starter set
 * that already clears AA on white. Order is the swatch order.
 */
export const COLOR_PRESETS: readonly string[] = [
  '#1c64f2', // action blue (app default)
  '#7c3aed', // violet
  '#0d9488', // teal
  '#dc2626', // red
  '#ea580c', // orange
  '#1f2937', // ink
] as const;

// ---------------------------------------------------------------------------
// asset URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a stored `brandLogoUrl` (the server returns a root-relative
 * `/api/branding/logo/file?key=...`) to an absolute URL so it loads even when
 * the web app and API run on different origins (dev). Pass-through for absolute
 * URLs and `null`.
 */
export function resolveLogoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

// ---------------------------------------------------------------------------
// plan gate (client mirror of common/entitlements.canUseBranding)
// ---------------------------------------------------------------------------

/**
 * Plans that unlock branding — a client mirror of the server's single source of
 * truth (`apps/api/src/common/entitlements.ts`). Used only to gate the UI (show
 * editor vs. locked upsell) without a flash; the server still enforces every
 * write with the same allow-set.
 */
const BRANDING_PLANS: ReadonlySet<string> = new Set(['TEAM', 'ENTERPRISE']);

/** Whether a plan may configure branding (mirror of `canUseBranding`). */
export function canUseBrandingPlan(plan: string | null | undefined): boolean {
  return typeof plan === 'string' && BRANDING_PLANS.has(plan);
}

// ---------------------------------------------------------------------------
// branding API client (authenticated; grain-2 endpoints)
// ---------------------------------------------------------------------------

/** Plan/entitlement snapshot returned alongside branding. */
export interface BrandingEntitlement {
  plan: string;
  canUseBranding: boolean;
}

/** The branding view returned by every read/write endpoint (mirror of the API). */
export interface BrandingView {
  /** Selected brand color (hex), or null when unset. */
  brandColor: string | null;
  /** Selected font key — always resolvable (defaults to the app body font). */
  brandFont: string;
  /** Servable (root-relative) URL for the current logo, or null when none. */
  brandLogoUrl: string | null;
  /** The closed font catalog (dropdown source). */
  fonts: readonly BrandFont[];
  /** Plan/entitlement snapshot. */
  entitlement: BrandingEntitlement;
}

/** Fields the admin can write (color and/or font). */
export interface BrandingUpdate {
  brandColor?: string;
  brandFont?: string;
}

function authToken(): string | undefined {
  return getToken() ?? undefined;
}

/** Current branding + entitlement for the signed-in owner. Team+ only (403 else). */
export function fetchBranding(): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding', { token: authToken() });
}

/** Persist brand color and/or font; returns the refreshed view. */
export function updateBranding(input: BrandingUpdate): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding', {
    method: 'PUT',
    token: authToken(),
    json: input,
  });
}

/** Remove the current brand logo (idempotent); returns the refreshed view. */
export function deleteLogo(): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding/logo', {
    method: 'DELETE',
    token: authToken(),
  });
}

/** Pull a single human message out of a Nest error body (string | string[]). */
function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message;
  if (Array.isArray(message) && message.length > 0 && typeof message[0] === 'string') {
    return message[0];
  }
  return null;
}

/**
 * Upload a brand logo as multipart `file`. A bespoke `fetch` is used (not
 * `apiFetch`, which JSON-encodes the body) so the `FormData` boundary is set by
 * the browser. Surfaces the server's Toss-tone copy on failure just like the
 * rest of the client.
 */
export async function uploadLogo(file: File): Promise<BrandingView> {
  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/branding/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken() ?? ''}` },
      body: form,
    });
  } catch {
    throw new ApiError(GENERIC_ERROR, 0);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(extractMessage(body) ?? GENERIC_ERROR, res.status);
  }
  return body as BrandingView;
}

// ---------------------------------------------------------------------------
// client-authored copy (mirrors messages.branding.* voice — single source)
// ---------------------------------------------------------------------------

/**
 * The admin-facing chrome strings authored on the client (the server only
 * returns error copy). Kept here as the single source so the Toss voice stays
 * consistent and auditable — same tone as the server `MESSAGES.branding`
 * catalog and the signer copy. Recorded in `messaging/branding.md`.
 */
export const BRANDING_COPY = {
  /** Page chrome. */
  title: '브랜딩',
  subtitle: '서명자에게 보여줄 로고·색상·글꼴을 설정해요.',
  navLabel: '브랜딩',

  /** Locked (non-Team) upsell — mirrors the server `forbidden` tone: entry
   *  condition only, no plan comparison, upgrade framed positively. */
  locked: {
    badge: '팀 플랜 기능',
    title: '브랜딩은 팀 플랜부터 쓸 수 있어요',
    body: '로고·색상·글꼴로 서명 화면을 우리 회사답게 꾸밀 수 있어요. 플랜을 업그레이드하면 바로 시작할 수 있어요.',
    cta: '플랜 업그레이드',
  },

  /** Logo uploader. */
  logo: {
    label: '로고',
    hint: 'JPG, PNG, SVG · 2MB 이하 · 가로로 긴 형태를 권장해요.',
    drop: '이미지를 끌어다 놓거나 클릭해서 올려 주세요',
    dropActive: '여기에 놓으면 올라가요',
    uploading: '올리는 중',
    replace: '다른 이미지로 바꾸기',
    remove: '삭제',
    previewAlt: '브랜드 로고 미리보기',
    tooLargeLocal: '이미지가 너무 커요. 2MB 이하 파일로 올려 주세요.',
    wrongTypeLocal: 'JPG, PNG, SVG 이미지만 올릴 수 있어요.',
  },

  /** Color picker. */
  color: {
    label: '브랜드 색상',
    hint: '버튼·링크 같은 강조 요소에 쓰여요.',
    inputLabel: '색상 코드',
    presetsLabel: '추천 색상',
    pick: '색상 선택',
    /** AA warning when the color is hard to read on a white background. */
    lowContrast: '흰 배경에서 잘 안 보일 수 있어요. 조금 더 진한 색을 권해요.',
  },

  /** Font dropdown. */
  font: {
    label: '글꼴',
    hint: '서명 화면 본문과 버튼에 쓰여요.',
    sample: '다람쥐 헌 쳇바퀴에 타고파',
  },

  /** Live preview. */
  preview: {
    label: '미리보기',
    hint: '서명자에게 이렇게 보여요.',
    sampleHeading: '계약서에 서명해 주세요',
    sampleBody: '내용을 확인하고 아래 버튼을 눌러 서명을 시작해요.',
    sampleCta: '서명 시작하기',
    sampleLink: '계약 내용 다시 보기',
  },

  /** Save action + outcomes. */
  save: '저장',
  saving: '저장 중',
  saved: '브랜딩을 저장했어요.',
  /** Neutral fallback when the server gives no message (network, etc.). */
  saveError: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
  loadError: '브랜딩 정보를 불러오지 못했어요.',
  retry: '다시 시도',
} as const;
