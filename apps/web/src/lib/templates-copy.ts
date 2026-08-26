/**
 * Templates list copy — the single source of truth for the "내 템플릿" screen's
 * user-facing strings (page heading, entry-point label, empty/error states, the
 * per-card meta line, the management actions, and the rename / delete-confirm /
 * preview dialogs). Kept here so structure/tone stay consistent and auditable,
 * mirroring `lib/settings-copy.ts` / `lib/todo-copy.ts`.
 *
 * Locale: every catalog is exposed as a `xCopyFor(locale: 'ko' | 'en')` accessor
 * (the standard from messaging/locale-copy-convention.md). The Korean catalog is
 * the `as const` base (single source of tone); the English branch is type-checked
 * against its widened shape, so a missing/misshapen English key is a compile
 * error. Tone follows the project base voice: plain 해요체, calm, action-forward,
 * never blaming the user — the destructive confirm names the consequence plainly
 * and offers a calm way out. The English branch keeps that voice (neutral, no
 * contractions).
 */

import { copyForLocale } from './copy-locale';

/** Read-only templates-list copy (heading, entry point, empty/error states). */
const TEMPLATES_COPY_KO = {
  /** Label for the entry point that opens the templates list (dashboard). */
  entryLabel: '내 템플릿',
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

/** Templates-list copy in the resolved locale. */
export const templatesCopyFor = copyForLocale<typeof TEMPLATES_COPY_KO>(TEMPLATES_COPY_KO, {
  entryLabel: 'My templates',
  title: 'My templates',
  description: 'All your saved layouts in one place. Load one the moment you create a contract.',
  listLabel: 'Template list',
  emptyTitle: 'No templates saved yet',
  emptyDescription:
    'Save a layout you use often as a template, and next time you can send it without placing fields again.',
  emptyCta: 'Create contract',
  errorRetry: 'Try again',
});

/**
 * Per-card management actions on the `/templates` list (manageable Extension) and
 * the dialogs they open (rename / delete-confirm / preview). Grouped so the whole
 * management surface reads in one voice.
 */
const TEMPLATE_ACTIONS_COPY_KO = {
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

  /**
   * Preview modal — read-only render of the template's source PDF with its saved
   * field layout overlaid. The purpose is confirming *where fields sit*, so the
   * description says so plainly and reassures that previewing never edits.
   */
  preview_dialog: {
    /** `{name}` is the template name. */
    title: (name: string) => `${name} 미리보기`,
    /** States the modal's purpose: confirm field placement, non-destructive. */
    description: '저장된 서명·날짜·텍스트란이 PDF 어디에 놓이는지 확인해 보세요. 미리보기는 템플릿을 바꾸지 않아요.',
    loading: '미리보기를 불러오고 있어요.',
    error: '미리보기를 불러오지 못했어요.',
    retry: '다시 시도',
    close: '닫기',
  },

  /** Page-level banner shown when an optimistic rename/delete is rolled back. */
  renameFailed: '이름을 바꾸지 못해 원래대로 되돌렸어요.',
  deleteFailed: '삭제하지 못해 목록에 다시 넣었어요.',
} as const;

/** Template management-action copy in the resolved locale. */
export const templateActionsCopyFor = copyForLocale<typeof TEMPLATE_ACTIONS_COPY_KO>(
  TEMPLATE_ACTIONS_COPY_KO,
  {
    start: 'Use this template',
    preview: 'Preview',
    rename: 'Rename',
    delete: 'Delete',
    actionsLabel: (name: string) => `Manage ${name}`,

    rename_dialog: {
      title: 'Rename template',
      description: 'Give it a name that is easy to find in the list.',
      nameLabel: 'Template name',
      namePlaceholder: 'e.g. Standard employment contract',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving',
    },

    delete_dialog: {
      title: (name: string) => `Delete "${name}"?`,
      description: 'This cannot be undone. Contracts you have already sent are unaffected.',
      cancel: 'Cancel',
      confirm: 'Delete',
      deleting: 'Deleting',
    },

    preview_dialog: {
      title: (name: string) => `${name} preview`,
      description:
        'See where the saved signature, date, and text fields sit on the PDF. Previewing never changes the template.',
      loading: 'Loading the preview.',
      error: 'We could not load the preview.',
      retry: 'Try again',
      close: 'Close',
    },

    renameFailed: 'We could not rename it, so we restored the original name.',
    deleteFailed: 'We could not delete it, so we put it back in the list.',
  },
);

/**
 * Read-only field-overlay preview surface (`template-field-preview.tsx`). Copy
 * for the page-flip controls, the field-type legend, and the per-field recipient
 * badge. This surface only *shows* where fields sit — no edit/save verbs — so the
 * tone stays purely descriptive ("여기에 무엇이 있는지"), matching `tone/templates-list.md`.
 */
const TEMPLATE_FIELD_PREVIEW_COPY_KO = {
  /** Accessible name for the rendered page canvas. `{page}`/`{total}` 1-based. */
  pageLabel: (page: number, total: number) => `템플릿 ${page}/${total}페이지 미리보기`,
  /** Prev/next page control labels (shown only for multi-page templates). */
  prevPage: '이전 페이지',
  nextPage: '다음 페이지',
  /** Page position indicator, e.g. `2 / 5`. */
  pageIndicator: (page: number, total: number) => `${page} / ${total}`,
  /** Legend heading above the field-type swatches. */
  legendLabel: '필드 종류',
  /** a11y name for a field box + its badge; `{n}` is the 1-based recipient slot. */
  recipientBadgeLabel: (n: number) => `수신자 ${n}`,
  /** Explains the number badge — shown only when a template has 2+ recipients. */
  recipientHint: '박스 왼쪽 위 숫자는 서명할 수신자 순서예요.',
  /** Shown over the page when the current page holds no placed fields. */
  noFieldsOnPage: '이 페이지에는 배치된 필드가 없어요.',
  /** Own loading + read-failure states (mirrors `PdfRenderError`'s message). */
  loading: '미리보기를 불러오고 있어요.',
  error: 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
} as const;

/** Field-preview copy in the resolved locale. */
export const templateFieldPreviewCopyFor = copyForLocale<typeof TEMPLATE_FIELD_PREVIEW_COPY_KO>(
  TEMPLATE_FIELD_PREVIEW_COPY_KO,
  {
    pageLabel: (page: number, total: number) => `Template preview, page ${page} of ${total}`,
    prevPage: 'Previous page',
    nextPage: 'Next page',
    pageIndicator: (page: number, total: number) => `${page} / ${total}`,
    legendLabel: 'Field types',
    recipientBadgeLabel: (n: number) => `Recipient ${n}`,
    recipientHint: 'The number at the top-left of each box is the signing order of the recipient.',
    noFieldsOnPage: 'No fields are placed on this page.',
    loading: 'Loading the preview.',
    error: 'We cannot read the PDF. Check that the file is not damaged.',
  },
);

/** Units for the per-card meta line (페이지 수 · 필드 수 · 저장일). */
const TEMPLATE_META_COPY_KO = {
  /** `2페이지` — page count of the source PDF. */
  pages: (n: number) => `${n}페이지`,
  /** `필드 3개` — how many placed fields the saved layout holds. */
  fields: (n: number) => `필드 ${n}개`,
  /** Suffix appended to the relative time, e.g. `3일 전 저장`. */
  savedSuffix: '저장',
} as const;

/** Template meta-line copy in the resolved locale. */
export const templateMetaCopyFor = copyForLocale<typeof TEMPLATE_META_COPY_KO>(
  TEMPLATE_META_COPY_KO,
  {
    pages: (n: number) => `${n} pages`,
    fields: (n: number) => `${n} fields`,
    savedSuffix: 'saved',
  },
);

/**
 * Every locale-branched copy surface this module owns, exposed as `{ ko, en }`
 * catalog pairs so the ko/en key-parity gate (templates-copy.test.ts) can assert
 * full structural parity without reaching into module internals.
 */
export const TEMPLATES_COPY_CATALOGS = {
  templates: { ko: templatesCopyFor('ko'), en: templatesCopyFor('en') },
  actions: { ko: templateActionsCopyFor('ko'), en: templateActionsCopyFor('en') },
  fieldPreview: { ko: templateFieldPreviewCopyFor('ko'), en: templateFieldPreviewCopyFor('en') },
  meta: { ko: templateMetaCopyFor('ko'), en: templateMetaCopyFor('en') },
} as const;
