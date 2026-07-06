/**
 * Copy for the sender's contract detail screen (`/contracts/[id]`).
 *
 * Centralized here like `SIGNER_COPY` / `COMPLETION_DOWNLOAD_COPY` so the screen
 * binds to a single source of truth. Toss-tone 해요체 (design-spec
 * `messaging/contract-detail.md`). The share-link *creation* modal and the link
 * list rendering live in grain-5; this module only owns the detail-screen shell,
 * the share entry point, and the empty/placeholder copy.
 */

export const CONTRACT_DETAIL_COPY = {
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
