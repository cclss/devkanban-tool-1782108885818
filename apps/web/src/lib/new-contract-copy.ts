/**
 * New-contract start-screen copy — the single source of truth for the strings on
 * `/contracts/new`'s entry chooser (design-spec `tone/new-contract-start.md`).
 *
 * This screen sits in front of the wizard: the sender picks how to start —
 * uploading a fresh PDF, or starting from a saved template — before any wizard
 * step renders. Kept here (mirroring `lib/templates-copy.ts` / `lib/settings-copy.ts`)
 * so structure/tone stay consistent and auditable.
 *
 * Locale: exposed as a `newContractCopyFor(locale: 'ko' | 'en')` accessor (the
 * standard from messaging/locale-copy-convention.md). The Korean catalog is the
 * `as const` base (single source of tone); the English branch is type-checked
 * against its widened shape, so a missing/misshapen English key is a compile
 * error — the very bug this locale refactor exists to close.
 *
 * Tone follows the project base voice: plain 해요체, calm, action-forward, never
 * blaming the user. Server-sent errors (template not found / forbidden, session
 * expiry) surface verbatim from the API; only transport failures fall back to the
 * neutral generic line, so no error *wording* is authored here. The English branch
 * keeps that voice (neutral, no contractions).
 */

import { copyForLocale } from './copy-locale';

/** Korean base catalog — single source of tone/structure for the start screen. */
const NEW_CONTRACT_COPY_KO = {
  // --- start choice -------------------------------------------------------
  /** H1 above the two start options. */
  chooseTitle: '새 계약을 만들어요',
  /** One-line prompt under the title. */
  chooseSubtitle: '어떻게 시작할지 골라 주세요.',
  /** Option 1 — the existing from-scratch upload path. */
  uploadTitle: '새로 업로드',
  uploadBody: 'PDF를 올리고 서명 필드를 직접 배치해요.',
  /** Option 2 — start from a saved template. */
  fromTemplateTitle: '내 템플릿에서 시작',
  fromTemplateBody: '저장해 둔 양식을 불러와 수신자만 입력하면 돼요.',

  // --- template picker ----------------------------------------------------
  /** H1 of the template-selection view. */
  pickTitle: '템플릿을 선택해 주세요',
  /** Sub-line explaining what selecting does. */
  pickSubtitle: '고르면 PDF와 필드 배치를 그대로 불러와요. 수신자만 입력하면 바로 발송할 수 있어요.',
  /** Back to the start choice. */
  pickBack: '뒤로',
  /** Accessible name for the list landmark. */
  listLabel: '템플릿 목록',
  /** a11y label for a selectable template card, e.g. `표준 근로계약서 템플릿으로 시작`. */
  selectLabel: (name: string) => `${name} 템플릿으로 시작`,

  // --- empty (no saved templates) -----------------------------------------
  emptyTitle: '아직 저장한 템플릿이 없어요',
  emptyBody:
    '자주 쓰는 양식을 템플릿으로 저장해 두면, 다음부터는 필드 배치 없이 바로 발송할 수 있어요.',
  /** Empty-state CTA → fall back to the upload path. */
  emptyCta: '새로 업로드',

  // --- preparing (loading the chosen template into the wizard) ------------
  preparingTitle: '템플릿을 불러오고 있어요',
  preparingBody: 'PDF와 필드 배치를 준비하고 있어요. 잠시만 기다려 주세요.',

  // --- shared actions -----------------------------------------------------
  /** Retry a failed load (list fetch or template prepare). */
  retry: '다시 시도',
  /** Bail out of a failed prepare back to the start choice. */
  startOver: '다른 방법으로 시작',
} as const;

/**
 * New-contract start-screen copy in the resolved locale. The choose-screen keys
 * mirror `web-translations` `wizard.*` (same rendered wording) so the module stays
 * the auditable single source without drifting from the runtime catalog.
 */
export const newContractCopyFor = copyForLocale<typeof NEW_CONTRACT_COPY_KO>(NEW_CONTRACT_COPY_KO, {
  chooseTitle: 'Create a new contract',
  chooseSubtitle: 'Choose how you would like to begin.',
  uploadTitle: 'Upload a PDF',
  uploadBody: 'Upload a PDF and place signature fields yourself.',
  fromTemplateTitle: 'Start from a template',
  fromTemplateBody: 'Load a saved layout and add recipients to send it right away.',

  pickTitle: 'Choose a template',
  pickSubtitle:
    'Pick one to load its PDF and field layout as-is. Just add recipients and you can send right away.',
  pickBack: 'Back',
  listLabel: 'Template list',
  selectLabel: (name: string) => `Start from the ${name} template`,

  emptyTitle: 'No templates saved yet',
  emptyBody:
    'Save a layout you use often as a template, and next time you can send it without placing fields again.',
  emptyCta: 'Upload a PDF',

  preparingTitle: 'Loading the template',
  preparingBody: 'Preparing the PDF and field layout. This will just take a moment.',

  retry: 'Try again',
  startOver: 'Start a different way',
});

/**
 * `{ ko, en }` catalog pair for the ko/en key-parity gate
 * (new-contract-copy.test.ts) — an empty `copyKeyDiff` means full structural
 * parity, so no English key can silently fall back to Korean.
 */
export const NEW_CONTRACT_COPY_CATALOGS = {
  start: { ko: newContractCopyFor('ko'), en: newContractCopyFor('en') },
} as const;
