/**
 * Settings section copy — the single source of truth for the settings shell's
 * user-facing strings (header brand mark, section title, navigation labels,
 * entry-point label, and each sub-section's intro). Kept here so structure/tone
 * stay consistent and auditable, mirroring `lib/todo-copy.ts`.
 *
 * Locale: every catalog is exposed as a `xCopyFor(locale: 'ko' | 'en')` accessor
 * (the standard from messaging/locale-copy-convention.md, mirroring
 * `signerCopyFor` / `todo-copy.ts`). The Korean catalog is the `as const` base
 * (single source of tone); the English branch is type-checked against its widened
 * shape, so a missing/misshapen English key is a compile error. Routes (e.g.
 * `SETTINGS_DEFAULT_ROUTE`) are locale-invariant and stay plain constants.
 *
 * Tone follows the project base voice (design-spec/messaging/recording.md):
 * plain 해요체, calm, action-forward. Labels are short nouns (Toss-style IA); the
 * English branch keeps that voice — short neutral nouns/CTAs, no contractions.
 */

import { copyForLocale, type SupportedCopyLocale } from './copy-locale';

/** A single item in the settings navigation. `href` is the sub-section route. */
export interface SettingsNavItem {
  /** Route this item links to, e.g. `/settings/branding`. */
  href: string;
  /** Localized menu label, e.g. `브랜딩` / `Branding`. */
  label: string;
}

/**
 * App header brand mark copy. The shared header (`DashboardHeader`) shows the
 * uploaded branding logo as an image when one is set, otherwise the service
 * wordmark. Centralized here — the same module that owns the settings entry
 * point, which lives in that header — so the service name and the logo's alt
 * text stay consistent. The English wordmark reuses the established `eSign`
 * product name (see `web-translations` `auth.product`).
 */
const HEADER_BRAND_COPY_KO = {
  /** Wordmark shown in the header when no branding logo is set. */
  wordmark: '전자계약',
  /** Alt text for the branding logo image (a11y: names the service mark). */
  logoAlt: '전자계약 로고',
} as const;

/** Header brand-mark copy in the resolved locale. */
export const headerBrandCopyFor = copyForLocale<typeof HEADER_BRAND_COPY_KO>(HEADER_BRAND_COPY_KO, {
  wordmark: 'eSign',
  logoAlt: 'eSign logo',
});

/** The default settings sub-section landed on when entering `/settings`. Route — locale-invariant. */
export const SETTINGS_DEFAULT_ROUTE = '/settings/branding';

/**
 * Settings shell copy: the header entry-point label, the shell H1, and the
 * accessible name for the settings navigation landmark.
 */
const SETTINGS_SHELL_COPY_KO = {
  /** Label for the header entry point that opens the settings section. */
  entryLabel: '설정',
  /** H1 shown at the top of the settings shell. */
  sectionTitle: '설정',
  /** Accessible name for the settings navigation landmark. */
  navLabel: '설정 메뉴',
} as const;

/** Settings shell copy in the resolved locale. */
export const settingsShellCopyFor = copyForLocale<typeof SETTINGS_SHELL_COPY_KO>(
  SETTINGS_SHELL_COPY_KO,
  {
    entryLabel: 'Settings',
    sectionTitle: 'Settings',
    navLabel: 'Settings menu',
  },
);

/**
 * Settings sub-section labels, keyed by section. Only sections with a real page
 * live here — no dead links. `SETTINGS_NAV_ROUTES` binds each label to its route;
 * future settings append a `{ key, href }` here and a matching label below.
 */
const SETTINGS_NAV_COPY_KO = {
  branding: '브랜딩',
  language: '언어',
} as const;

/** Settings sub-section labels in the resolved locale. */
export const settingsNavCopyFor = copyForLocale<typeof SETTINGS_NAV_COPY_KO>(SETTINGS_NAV_COPY_KO, {
  branding: 'Branding',
  language: 'Language',
});

/** Sub-section routes in menu order, each bound to a label key. Routes — locale-invariant. */
const SETTINGS_NAV_ROUTES = [
  { key: 'branding', href: '/settings/branding' },
  { key: 'language', href: '/settings/language' },
] as const satisfies readonly { key: keyof typeof SETTINGS_NAV_COPY_KO; href: string }[];

/** Settings navigation items (route + localized label), in menu order. */
export function settingsNavItemsFor(locale: SupportedCopyLocale): readonly SettingsNavItem[] {
  const labels = settingsNavCopyFor(locale);
  return SETTINGS_NAV_ROUTES.map(({ key, href }) => ({ href, label: labels[key] }));
}

/** Intro copy for the 브랜딩 sub-section (heading + one-line description). */
const BRANDING_COPY_KO = {
  title: '브랜딩',
  description: '로고, 파비콘, 대표 색상을 설정해 서비스 전반에 우리 브랜드를 입혀요.',
} as const;

/** 브랜딩 sub-section intro copy in the resolved locale. */
export const brandingCopyFor = copyForLocale<typeof BRANDING_COPY_KO>(BRANDING_COPY_KO, {
  title: 'Branding',
  description: 'Set your logo, favicon, and brand color to apply your brand across the service.',
});

/**
 * Copy for the branding form that assembles the two image uploaders (로고 ·
 * 파비콘) and the 대표 색상 picker with a save/cancel action bar. Field labels
 * are short nouns. Saving really persists and reflects service-wide, so the
 * status line is honest that the change already took effect for everyone. The
 * "already set" hints tell the admin a stored logo/favicon exists and that a new
 * upload replaces it. Tone: plain 해요체, calm, {what happened} + {result}.
 */
const BRANDING_FORM_COPY_KO = {
  /** Label for the logo image uploader field. */
  logoLabel: '로고',
  /** Label for the favicon image uploader field. */
  faviconLabel: '파비콘',
  /** Hint shown on the logo uploader when a logo is already stored. */
  logoSetHint: '지금 설정된 로고가 있어요. 새 SVG 또는 PNG(최대 1MB)를 올리면 바뀌어요.',
  /** Hint shown on the favicon uploader when a favicon is already stored. */
  faviconSetHint: '지금 설정된 파비콘이 있어요. 새 SVG 또는 PNG(최대 1MB)를 올리면 바뀌어요.',
  /** Primary action — persists the current inputs and reflects them service-wide. */
  save: '저장',
  /** Secondary action — reverts the fields to the last saved values. */
  cancel: '취소',
  /**
   * Shown after a successful save. Honest: the settings are saved and already in
   * force across the service (header logo · browser-tab favicon · brand color).
   */
  savedNotice: '브랜딩 설정을 저장했어요. 서비스 전반에 바로 반영했어요.',
} as const;

/** Branding-form copy in the resolved locale. */
export const brandingFormCopyFor = copyForLocale<typeof BRANDING_FORM_COPY_KO>(
  BRANDING_FORM_COPY_KO,
  {
    logoLabel: 'Logo',
    faviconLabel: 'Favicon',
    logoSetHint: 'A logo is set. Upload a new SVG or PNG (up to 1MB) to replace it.',
    faviconSetHint: 'A favicon is set. Upload a new SVG or PNG (up to 1MB) to replace it.',
    save: 'Save',
    cancel: 'Cancel',
    savedNotice: 'Branding saved. It is now live across the service.',
  },
);

/**
 * Copy for the 대표 색상 color picker (swatch + HEX input + live preview).
 * Single source so the control's label, guidance, and validation message stay
 * in base voice (blame-free 해요체, points to the next action). The error line
 * follows `{what is off} + {how to fix, with an example}` like the uploader guard.
 */
const BRAND_COLOR_COPY_KO = {
  label: '대표 색상',
  hint: '버튼·링크 같은 주요 요소에 쓰일 색이에요. #163AF2처럼 색상 코드를 입력하거나 색상판에서 골라요.',
  /** Shown when the typed HEX code isn't a valid `#rgb` / `#rrggbb` value. */
  invalidHex: '색상 코드를 확인해 주세요. #163AF2처럼 3자리 또는 6자리로 입력해요.',
  /** Accessible name for the swatch that opens the native color picker. */
  swatchLabel: '색상판에서 대표 색상 고르기',
  /** Caption above the preview strip. */
  previewLabel: '미리보기',
  /** Sample elements inside the preview, so the swatch shows real re-skinning. */
  previewButton: '서명 요청 보내기',
  previewLink: '계약서 미리보기',
} as const;

/** Brand-color-picker copy in the resolved locale. */
export const brandColorCopyFor = copyForLocale<typeof BRAND_COLOR_COPY_KO>(BRAND_COLOR_COPY_KO, {
  label: 'Brand color',
  hint: 'Used for key elements like buttons and links. Enter a color code like #163AF2 or pick one from the palette.',
  invalidHex: 'Check the color code. Enter 3 or 6 digits, like #163AF2.',
  swatchLabel: 'Pick a brand color from the palette',
  previewLabel: 'Preview',
  previewButton: 'Send signature request',
  previewLink: 'Preview contract',
});

/**
 * Every locale-branched copy surface this module owns, exposed as `{ ko, en }`
 * catalog pairs so the ko/en key-parity gate (settings-copy.test.ts) can assert
 * full structural parity without reaching into module internals.
 */
export const SETTINGS_COPY_CATALOGS = {
  headerBrand: { ko: headerBrandCopyFor('ko'), en: headerBrandCopyFor('en') },
  shell: { ko: settingsShellCopyFor('ko'), en: settingsShellCopyFor('en') },
  nav: { ko: settingsNavCopyFor('ko'), en: settingsNavCopyFor('en') },
  branding: { ko: brandingCopyFor('ko'), en: brandingCopyFor('en') },
  brandingForm: { ko: brandingFormCopyFor('ko'), en: brandingFormCopyFor('en') },
  brandColor: { ko: brandColorCopyFor('ko'), en: brandColorCopyFor('en') },
} as const;
