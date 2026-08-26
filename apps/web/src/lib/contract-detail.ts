/**
 * Copy for the sender's contract detail screen (`/contracts/[id]`).
 *
 * Centralized here like `SIGNER_COPY` / `COMPLETION_DOWNLOAD_COPY` so the screen
 * binds to a single source of truth. Toss-tone 해요체 (design-spec
 * `messaging/contract-detail.md`). The share-link *creation* modal and the link
 * list rendering live in `sharing.ts`; this module only owns the detail-screen
 * shell, the share entry point, and the empty/placeholder copy.
 *
 * Locale: `contractDetailCopyFor(locale)` returns the Korean catalog for `'ko'`
 * and the type-checked English catalog for `'en'` (the standard adopted in
 * messaging/locale-copy-convention.md, mirroring `signerCopyFor`). The Korean
 * catalog is the `as const` base (single source of tone); the English branch is
 * type-checked against its widened shape, so a missing/misshapen English key is
 * a compile error — the miss can never silently fall back to Korean.
 */

import { copyForLocale, type SupportedCopyLocale } from './copy-locale';

const CONTRACT_DETAIL_COPY_KO = {
  /** Back affordance → dashboard. */
  back: '계약 목록',
  backAria: '계약 목록으로 돌아가기',

  /** Summary definition list labels. */
  summary: {
    recipients: '받는 분',
    pages: '분량',
    created: '생성일',
    sent: '발송일',
    completed: '완료일',
    /** Shown when the contract has no addressed recipients (link-only sharing). */
    linkOnly: '링크 공유',
    recipientCount: (n: number) => `${n}명`,
    pageCount: (n: number) => `${n}페이지`,
  },

  /** Share-link section (the '링크로 공유' entry point + link list slot). */
  share: {
    sectionTitle: '공유 링크',
    sectionHelp:
      '링크를 만들어 받는 분에게 전달하면, 로그인 없이 계약서를 열고 작성할 수 있어요.',
    createButton: '링크로 공유',
    emptyTitle: '아직 만든 공유 링크가 없어요',
    emptyBody: '‘링크로 공유’를 눌러 첫 링크를 만들어 보세요.',
  },

  /** 404 / no-access terminal for the detail route. */
  notFoundTitle: '계약을 찾을 수 없어요',
  notFoundBody: '이미 삭제되었거나 접근할 수 없는 계약이에요.',
  notFoundAction: '계약 목록으로',
} as const;

/** Contract-detail copy in the locale resolved for the screen. */
export const contractDetailCopyFor = copyForLocale<typeof CONTRACT_DETAIL_COPY_KO>(
  CONTRACT_DETAIL_COPY_KO,
  {
    back: 'Contracts',
    backAria: 'Back to contracts',
    summary: {
      recipients: 'Recipients',
      pages: 'Length',
      created: 'Created',
      sent: 'Sent',
      completed: 'Completed',
      linkOnly: 'Link sharing',
      recipientCount: (n: number) => `${n} recipients`,
      pageCount: (n: number) => `${n} pages`,
    },
    share: {
      sectionTitle: 'Share links',
      sectionHelp:
        'Create a link and send it to your recipient so they can open and fill out the contract without signing in.',
      createButton: 'Share via link',
      emptyTitle: 'No share links yet',
      emptyBody: 'Select “Share via link” to create your first link.',
    },
    notFoundTitle: 'We could not find this contract',
    notFoundBody: 'It may have been deleted, or you may not have access to it.',
    notFoundAction: 'Back to contracts',
  },
);

/** The locale-branched copy for this surface as `{ ko, en }` for the parity gate. */
export const CONTRACT_DETAIL_COPY_CATALOGS = {
  detail: { ko: contractDetailCopyFor('ko'), en: contractDetailCopyFor('en') },
} as const satisfies Record<string, { ko: unknown; en: unknown }>;

export type ContractDetailCopy = ReturnType<typeof contractDetailCopyFor>;
export type { SupportedCopyLocale };
