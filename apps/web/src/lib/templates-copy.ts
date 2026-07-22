/**
 * Templates list copy — the single source of truth for the "내 템플릿" screen's
 * user-facing strings (page heading, entry-point label, empty/error states, and
 * the per-card meta line). Kept here so structure/tone stay consistent and
 * auditable, mirroring `lib/settings-copy.ts` / `lib/todo-copy.ts`.
 *
 * Tone follows the project base voice (design-spec `tone/*`): plain 해요체, calm,
 * action-forward, never blaming the user. This is a read-only list; there are no
 * mutate actions here (rename/delete/preview land in a later grain), so the copy
 * only describes what's here and points to the next step (새 계약).
 */

/** Label for the entry point that opens the templates list (dashboard). */
export const TEMPLATES_ENTRY_LABEL = '내 템플릿';

export const TEMPLATES_COPY = {
  /** H1 at the top of the list. Matches the save dialog's '내 템플릿' promise. */
  title: '내 템플릿',
  /** One-line intro under the title. */
  description: '저장해 둔 양식을 모아 봐요. 새 계약을 만들 때 바로 불러올 수 있어요.',
  /** Accessible name for the list landmark. */
  listLabel: '템플릿 목록',
  /** Empty state — no template saved yet. */
  emptyTitle: '아직 저장한 템플릿이 없어요',
  emptyDescription:
    '자주 쓰는 양식을 템플릿으로 저장해 두면, 다음부터는 필드 배치 없이 바로 발송할 수 있어요.',
  /** Empty-state CTA → the wizard, where a template gets saved. */
  emptyCta: '새 계약 만들기',
  /** Retry label shown when the list fails to load. */
  errorRetry: '다시 시도',
} as const;

/** Units for the per-card meta line (페이지 수 · 필드 수 · 저장일). */
export const TEMPLATE_META_COPY = {
  /** `2페이지` — page count of the source PDF. */
  pages: (n: number) => `${n}페이지`,
  /** `필드 3개` — how many placed fields the saved layout holds. */
  fields: (n: number) => `필드 ${n}개`,
  /** Suffix appended to the relative time, e.g. `3일 전 저장`. */
  savedSuffix: '저장',
} as const;
