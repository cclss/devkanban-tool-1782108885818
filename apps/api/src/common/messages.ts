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
    // Google 소셜 인증 실패 — 잘못/만료된 인가 코드, 토큰 교환·검증 실패 등.
    // 실패 원인(코드 만료/검증 오류 등 내부 사정)을 특정하지 않고 다음 행동만 안내.
    googleAuthFailed: 'Google 로그인에 실패했어요. 다시 시도해 주세요.',
    // Google 계정의 이메일이 아직 인증되지 않음 — 다음 행동(이메일 인증)을 안내.
    googleEmailUnverified: 'Google 계정의 이메일 인증이 필요해요. 이메일 인증을 마친 뒤 다시 시도해 주세요.',
    // 서버에 Google 자격증명이 설정되지 않아 일시적으로 사용할 수 없음 —
    // 내부 설정 사정을 노출하지 않고 일시적 불가로만 안내(503).
    googleUnavailable: '지금은 Google 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
  },
  document: {
    notFound: '요청한 계약을 찾을 수 없어요.',
    forbidden: '이 계약에 접근할 권한이 없어요.',
    // 완료 후처리(최종본·인증서)가 아직 끝나지 않아 내려받을 수 없을 때.
    artifactNotReady: '완료 문서가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.',
    invalidFileType: 'PDF 또는 DOCX 파일만 업로드할 수 있어요.',
    emptyFile: '파일이 비어 있어요. 다른 파일로 다시 시도해 주세요.',
    corruptPdf: 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
    corruptDocx: 'DOCX를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
    fileTooLarge: '파일이 너무 커요. 20MB 이하의 파일로 올려 주세요.',
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
  // 서명자 대면 메시지 — 링크로 접속한 외부 서명자가 보는 카피.
  // 발신자 톤과 동일하게: 탓하지 않고 다음 행동을 부드럽게 안내한다.
  signing: {
    // 잘못된/없는 서명 링크 — 토큰 자체가 유효하지 않을 때.
    invalidLink: '서명 링크가 올바르지 않아요. 발신자에게 링크를 다시 요청해 주세요.',
    // 6자리 코드 불일치 — 어느 자리가 틀렸는지 특정하지 않는다.
    codeMismatch: '인증 코드가 일치하지 않아요. 다시 확인해 주세요.',
    // 형식 오류(6자리 숫자가 아님).
    codeFormat: '6자리 인증 코드를 정확히 입력해 주세요.',
    // 연속 실패로 인한 일시 잠금 — 완화는 시간 경과로 자동 해제됨을 알린다.
    locked: '인증을 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.',
    // 서명자 세션(단기 토큰) 만료 — 코드 재입력으로 부드럽게 안내.
    sessionExpired: '본인확인 후 시간이 지났어요. 인증 코드를 다시 입력해 주세요.',
    // 이미 서명을 마친 계약에 다시 접근.
    alreadySigned: '이미 서명을 완료한 계약이에요.',
    // 더 이상 서명할 수 없는 상태(취소/만료된 계약 등).
    notSignable: '더 이상 서명할 수 없는 계약이에요. 발신자에게 문의해 주세요.',
    // 서명/입력 값이 형식에 맞지 않음.
    invalidFieldValue: '입력한 값을 다시 확인해 주세요.',
    // 배정된 서명 항목 중 빈 항목이 남아 완료 불가.
    fieldsIncomplete: '아직 작성하지 않은 항목이 있어요. 모두 채운 뒤 완료해 주세요.',
    // 완료 성공 헤드라인 — spec의 "…완료되었습니다!" 형식.
    completed: '서명이 완료되었습니다!',
  },
} as const;

/**
 * 서명자 본인확인(6자리 코드) 보호 정책.
 * 연속 실패가 잠금 임계치에 도달하면 잠금 창(window) 동안 인증을 차단하고,
 * 시간이 지나면 자동으로 완화(해제)된다.
 */
export const SIGNER_VERIFY_MAX_ATTEMPTS = 5;
/** 잠금 창 — 이 시간(분) 내 실패 횟수로 잠금 여부를 판단한다. */
export const SIGNER_VERIFY_LOCK_WINDOW_MINUTES = 15;
/** 서명자 세션(단기 토큰) 유효 시간. */
export const SIGNER_SESSION_TTL_MINUTES = 30;

/** Free plan monthly send limit. */
export const FREE_PLAN_MONTHLY_LIMIT = 5;
