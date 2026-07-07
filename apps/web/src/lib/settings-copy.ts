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

/** Intro copy for the 브랜딩 sub-section (the form controls arrive later). */
export const BRANDING_COPY = {
  title: '브랜딩',
  description: '로고, 파비콘, 대표 색상을 설정해 서비스 전반에 우리 브랜드를 입혀요.',
  /** Placeholder shown while the branding form is being prepared. */
  placeholder: '브랜딩 설정을 준비하고 있어요. 곧 이곳에서 로고와 색상을 바꿀 수 있어요.',
} as const;
