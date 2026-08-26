import type { SupportedLocale } from './locale';

/** Browser UI catalog. Missing English copy always falls back to Korean. */
export const WEB_TRANSLATIONS = {
  ko: {
    auth: { product: '전자계약', loginTitle: '다시 오셨네요', loginHint: '이메일과 비밀번호로 로그인해 주세요.', email: '이메일', password: '비밀번호', login: '로그인', loggingIn: '로그인 중', googleLogin: 'Google로 로그인', noAccount: '아직 계정이 없으신가요?', signup: '회원가입', emailRequired: '이메일을 입력해 주세요.', emailInvalid: '이메일 형식을 다시 확인해 주세요.', passwordRequired: '비밀번호를 입력해 주세요.' },
    dashboard: { title: '계약', description: '보낸 계약의 진행 상황을 한눈에 확인하세요.', templates: '내 템플릿', newContract: '새 계약 생성', listLabel: '계약 목록', loadError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
    settings: { title: '설정', navLabel: '설정 메뉴', branding: '브랜딩', language: '언어', languageTitle: '언어 설정', languageDescription: '서비스에서 사용할 언어를 선택하세요. 모든 화면에 적용됩니다.', preference: '선호 언어', korean: '한국어 (Korean)', english: 'English', previewTitle: '실시간 미리보기', previewDashboard: '대시보드', previewEmail: '완료 알림 이메일', previewStatus: '서명 대기 중', previewAction: '새 계약 보내기', previewEmailSubject: '[계약 완료] 계약서 서명이 완료되었습니다', cancel: '취소', save: '변경사항 저장', saving: '저장 중…', saved: '언어 설정이 저장되었습니다.', saveFailed: '언어 설정을 저장하지 못했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
    wizard: { chooseTitle: '새 계약을 만들어요', chooseSubtitle: '어떻게 시작할지 골라 주세요.', uploadTitle: '새로 업로드', uploadBody: 'PDF를 올리고 서명 필드를 직접 배치해요.', templateTitle: '내 템플릿에서 시작', templateBody: '저장해 둔 양식을 불러와 수신자만 입력하면 돼요.', product: '전자계약', exit: '나가기', exitLabel: '계약 생성 나가기' },
    signer: { verifyTitle: '본인확인', verifyHint: '문자로 받은 6자리 인증 코드를 입력해 주세요.', codeLabel: '인증 코드', verify: '본인확인', verifying: '확인 중', genericError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
  },
  en: {
    auth: { product: 'eSign', loginTitle: 'Welcome back', loginHint: 'Sign in with your email and password.', email: 'Email', password: 'Password', login: 'Sign in', loggingIn: 'Signing in', googleLogin: 'Continue with Google', noAccount: 'New here?', signup: 'Create an account', emailRequired: 'Enter your email address.', emailInvalid: 'Check your email address.', passwordRequired: 'Enter your password.' },
    dashboard: { title: 'Contracts', description: 'Track the progress of contracts you have sent.', templates: 'My templates', newContract: 'Create contract', listLabel: 'Contract list', loadError: 'Something went wrong. Please try again shortly.' },
    settings: { title: 'Settings', navLabel: 'Settings menu', branding: 'Branding', language: 'Language', languageTitle: 'Language settings', languageDescription: 'Choose the language used throughout the service.', preference: 'Preferred language', korean: '한국어 (Korean)', english: 'English', previewTitle: 'Live preview', previewDashboard: 'Dashboard', previewEmail: 'Completion email', previewStatus: 'Awaiting signature', previewAction: 'Send new contract', previewEmailSubject: '[Contract completed] Your contract has been signed', cancel: 'Cancel', save: 'Save changes', saving: 'Saving…', saved: 'Language setting saved.', saveFailed: 'We could not save your language setting. Please try again.', retry: 'Try again' },
    wizard: { chooseTitle: 'Create a new contract', chooseSubtitle: 'Choose how you would like to begin.', uploadTitle: 'Upload a PDF', uploadBody: 'Upload a PDF and place signature fields yourself.', templateTitle: 'Start from a template', templateBody: 'Load a saved layout and add recipients to send it right away.', product: 'eSign', exit: 'Exit', exitLabel: 'Exit contract creation' },
    signer: { verifyTitle: 'Verify your identity', verifyHint: 'Enter the 6-digit verification code sent by text message.', codeLabel: 'Verification code', verify: 'Verify identity', verifying: 'Verifying', genericError: 'Something went wrong. Please try again shortly.' },
  },
} as const;

export type WebTranslationKey = `${keyof (typeof WEB_TRANSLATIONS)['ko']}.${string}`;

export function translateWeb(locale: SupportedLocale, key: WebTranslationKey): string {
  const [domain, name] = key.split('.') as [keyof (typeof WEB_TRANSLATIONS)['ko'], string];
  const localized = WEB_TRANSLATIONS[locale][domain] as Record<string, string>;
  const fallback = WEB_TRANSLATIONS.ko[domain] as Record<string, string>;
  return localized[name] ?? fallback[name] ?? key;
}
