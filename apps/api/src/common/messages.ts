/**
 * Centralized, user-facing API messages (Korean).
 *
 * Tone follows the Toss-inspired voice defined in the design spec
 * (`design-spec/messaging/recording.md`):
 *   - 사용자를 탓하지 않고, 다음 행동을 부드럽게 안내한다.
 *   - 해요체 + 정중한 "~해 주세요" / "~할 수 없어요" / "다시 확인해 주세요".
 *   - 성공 헤드라인은 spec에 명시된 형식("…완료되었습니다!")을 따른다.
 *   - 시스템 내부 사정(스택/원인)을 그대로 노출하지 않는다.
 *
 * Keep every user-visible string here so copy stays consistent and auditable.
 */
export const MESSAGES = {
  auth: {
    // 로그인 실패 — 어느 쪽이 틀렸는지 특정하지 않아 보안·말투 모두 부드럽게.
    invalidCredentials: '이메일 또는 비밀번호를 다시 확인해 주세요.',
    emailTaken: '이미 가입된 이메일이에요. 로그인해 주세요.',
    unauthorized: '로그인이 필요해요. 다시 로그인해 주세요.',
    sessionExpired: '로그인 정보가 만료됐어요. 다시 로그인해 주세요.',
  },
  document: {
    notFound: '요청한 계약을 찾을 수 없어요.',
    forbidden: '이 계약에 접근할 권한이 없어요.',
    invalidFileType: 'PDF 파일만 업로드할 수 있어요.',
    emptyFile: '파일이 비어 있어요. 다른 PDF로 다시 시도해 주세요.',
    corruptPdf: 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
    fileTooLarge: '파일이 너무 커요. 20MB 이하의 PDF로 올려 주세요.',
  },
  field: {
    outOfRange: '서명 필드 위치가 올바르지 않아요. 문서 안에 배치해 주세요.',
  },
  send: {
    noRecipients: '받는 분을 한 명 이상 추가해 주세요.',
    alreadySent: '이미 발송된 계약이에요.',
    noFields: '서명 필드를 한 개 이상 배치한 뒤 발송해 주세요.',
    // Free 플랜 월 5건 초과 — 한도를 명확히 알리고 다음 행동(업그레이드/다음 달)을 안내.
    quotaExceeded:
      '이번 달 무료 발송 5건을 모두 사용했어요. 다음 달에 다시 발송하거나 플랜을 업그레이드해 주세요.',
  },
} as const;

/** Free plan monthly send limit. */
export const FREE_PLAN_MONTHLY_LIMIT = 5;
