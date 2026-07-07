/**
 * Settings section copy — the single source of truth for the settings shell's
 * user-facing strings (section title, navigation labels, entry-point label, and
 * each sub-section's intro). Kept here so structure/tone stay consistent and
 * auditable, mirroring `lib/todo-copy.ts` / `lib/onboarding-copy.ts`.
 *
 * Tone follows the project base voice (design-spec/messaging/recording.md):
 * plain 해요체, calm, action-forward. Labels are short nouns (Toss-style IA).
 */

/** A single item in the settings navigation. `href` is the sub-section route. */
export interface SettingsNavItem {
  /** Route this item links to, e.g. `/settings/branding`. */
  href: string;
  /** Korean menu label, e.g. `브랜딩`. */
  label: string;
}

/**
 * App header brand mark copy. The shared header (`DashboardHeader`) shows the
 * uploaded branding logo as an image when one is set, otherwise the 전자계약
 * wordmark. Centralized here — the same module that owns the settings entry
 * point, which lives in that header — so the service name and the logo's alt
 * text stay consistent and auditable. Tone follows the project base voice.
 */
export const HEADER_BRAND_COPY = {
  /** Wordmark shown in the header when no branding logo is set. */
  wordmark: '전자계약',
  /** Alt text for the branding logo image (a11y: names the service mark). */
  logoAlt: '전자계약 로고',
} as const;

/** Label for the header entry point that opens the settings section. */
export const SETTINGS_ENTRY_LABEL = '설정';

/** H1 shown at the top of the settings shell. */
export const SETTINGS_SECTION_TITLE = '설정';

/** Accessible name for the settings navigation landmark. */
export const SETTINGS_NAV_LABEL = '설정 메뉴';

/**
 * Settings sub-sections, in menu order. Only sections with a real page live
 * here — no dead links. Future settings (알림, 보안 등) append to this list and
 * the shell/nav pick them up with no structural change.
 */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { href: '/settings/branding', label: '브랜딩' },
];

/** The default settings sub-section landed on when entering `/settings`. */
export const SETTINGS_DEFAULT_ROUTE = '/settings/branding';

/** Intro copy for the 브랜딩 sub-section (heading + one-line description). */
export const BRANDING_COPY = {
  title: '브랜딩',
  description: '로고, 파비콘, 대표 색상을 설정해 서비스 전반에 우리 브랜드를 입혀요.',
} as const;

/**
 * Copy for the branding form that assembles the two image uploaders (로고 ·
 * 파비콘) and the 대표 색상 picker with a save/cancel action bar. Field labels
 * are short nouns; the save affordance stays honest about scope — the values are
 * held locally and a calm status line tells the user that service-wide reflection
 * is still on the way (no backend brand-update path exists yet). Tone follows the
 * project base voice: plain 해요체, calm, {what happened} + {what's next}.
 */
export const BRANDING_FORM_COPY = {
  /** Label for the logo image uploader field. */
  logoLabel: '로고',
  /** Label for the favicon image uploader field. */
  faviconLabel: '파비콘',
  /** Primary action — commits the current inputs (held locally for now). */
  save: '저장',
  /** Secondary action — reverts the fields to the last saved values. */
  cancel: '취소',
  /**
   * Shown after a successful save. Honest about scope: the settings are kept,
   * and applying them across the service is coming (not yet wired to a backend).
   */
  savedNotice: '브랜딩 설정을 저장했어요. 서비스 전반 반영은 곧 제공돼요.',
} as const;

/**
 * Copy for the 대표 색상 color picker (swatch + HEX input + live preview).
 * Single source so the control's label, guidance, and validation message stay
 * in base voice (blame-free 해요체, points to the next action). The error line
 * follows `{what's off} + {how to fix, with an example}` like the uploader guard.
 */
export const BRAND_COLOR_COPY = {
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
