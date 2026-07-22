/**
 * Templates list copy — the single source of truth for the "내 템플릿" screen's
 * user-facing strings (page heading, entry-point label, empty/error states, and
 * the per-card meta line). Kept here so structure/tone stay consistent and
 * auditable, mirroring `lib/settings-copy.ts` / `lib/todo-copy.ts`.
 *
 * Tone follows the project base voice (design-spec `tone/*`): plain 해요체, calm,
 * action-forward, never blaming the user. Alongside the read-only list strings,
 * this owns the per-card management actions (미리보기·이름 수정·삭제·이 템플릿으로
 * 시작) and the rename / delete-confirm / preview dialog copy — the destructive
 * confirm names the consequence plainly and offers a calm way out, never blaming.
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

/**
 * Per-card management actions on the `/templates` list (manageable Extension) and
 * the dialogs they open (rename / delete-confirm / preview). Grouped so the whole
 * management surface reads in one voice.
 */
export const TEMPLATE_ACTIONS_COPY = {
  /** Primary card action → `/contracts/new?template=id` (reuse this layout). */
  start: '이 템플릿으로 시작',
  /** Open the read-only PDF preview modal. */
  preview: '미리보기',
  /** Open the rename modal. */
  rename: '이름 수정',
  /** Open the delete-confirm modal. */
  delete: '삭제',
  /** a11y group label for the action cluster; `{name}` is the template name. */
  actionsLabel: (name: string) => `${name} 관리`,

  /** Rename modal. */
  rename_dialog: {
    title: '템플릿 이름 수정',
    description: '목록에서 찾기 쉬운 이름으로 바꿔 주세요.',
    nameLabel: '템플릿 이름',
    namePlaceholder: '예: 표준 근로계약서',
    cancel: '취소',
    save: '저장',
    saving: '저장 중',
  },

  /** Delete-confirm modal. */
  delete_dialog: {
    /** `{name}` is the template name. */
    title: (name: string) => `'${name}'을(를) 삭제할까요?`,
    description: '삭제하면 되돌릴 수 없어요. 이미 발송한 계약에는 영향을 주지 않아요.',
    cancel: '취소',
    confirm: '삭제',
    deleting: '삭제 중',
  },

  /** Preview modal — read-only first-page render of the template's source PDF. */
  preview_dialog: {
    /** `{name}` is the template name. */
    title: (name: string) => `${name} 미리보기`,
    loading: '미리보기를 불러오고 있어요.',
    error: '미리보기를 불러오지 못했어요.',
    retry: '다시 시도',
    close: '닫기',
  },

  /** Page-level banner shown when an optimistic rename/delete is rolled back. */
  renameFailed: '이름을 바꾸지 못해 원래대로 되돌렸어요.',
  deleteFailed: '삭제하지 못해 목록에 다시 넣었어요.',
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
