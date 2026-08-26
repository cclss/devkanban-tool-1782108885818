import type { SupportedLocale } from './locale';

/** Browser UI catalog. Missing English copy always falls back to Korean. */
export const WEB_TRANSLATIONS = {
  ko: {
    meta: { title: '전자계약', description: '전자계약 SaaS' },
    auth: { product: '전자계약', loginTitle: '다시 오셨네요', loginHint: '이메일과 비밀번호로 로그인해 주세요.', email: '이메일', password: '비밀번호', login: '로그인', loggingIn: '로그인 중', googleLogin: 'Google로 로그인', noAccount: '아직 계정이 없으신가요?', signup: '회원가입', emailRequired: '이메일을 입력해 주세요.', emailInvalid: '이메일 형식을 다시 확인해 주세요.', passwordRequired: '비밀번호를 입력해 주세요.' },
    dashboard: { title: '계약', description: '보낸 계약의 진행 상황을 한눈에 확인하세요.', templates: '내 템플릿', newContract: '새 계약 생성', listLabel: '계약 목록', loadError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
    settings: { title: '설정', navLabel: '설정 메뉴', branding: '브랜딩', language: '언어', languageTitle: '언어 설정', languageDescription: '서비스에서 사용할 언어를 선택하세요. 모든 화면에 적용됩니다.', preference: '선호 언어', korean: '한국어 (Korean)', english: 'English', previewTitle: '실시간 미리보기', previewDashboard: '대시보드', previewEmail: '완료 알림 이메일', previewStatus: '서명 대기 중', previewAction: '새 계약 보내기', previewEmailSubject: '[계약 완료] 계약서 서명이 완료되었습니다', cancel: '취소', save: '변경사항 저장', saving: '저장 중…', saved: '언어 설정이 저장되었습니다.', saveFailed: '언어 설정을 저장하지 못했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
    wizard: { chooseTitle: '새 계약을 만들어요', chooseSubtitle: '어떻게 시작할지 골라 주세요.', uploadTitle: '새로 업로드', uploadBody: 'PDF를 올리고 서명 필드를 직접 배치해요.', templateTitle: '내 템플릿에서 시작', templateBody: '저장해 둔 양식을 불러와 수신자만 입력하면 돼요.', product: '전자계약', exit: '나가기', exitLabel: '계약 생성 나가기' },
    signer: { verifyTitle: '본인확인', verifyHint: '문자로 받은 6자리 인증 코드를 입력해 주세요.', codeLabel: '인증 코드', verify: '본인확인', verifying: '확인 중', genericError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
  },
  en: {
    meta: { title: 'eSign', description: 'Electronic contract SaaS' },
    auth: { product: 'eSign', loginTitle: 'Welcome back', loginHint: 'Sign in with your email and password.', email: 'Email', password: 'Password', login: 'Sign in', loggingIn: 'Signing in', googleLogin: 'Continue with Google', noAccount: 'New here?', signup: 'Create an account', emailRequired: 'Enter your email address.', emailInvalid: 'Check your email address.', passwordRequired: 'Enter your password.' },
    dashboard: { title: 'Contracts', description: 'Track the progress of contracts you have sent.', templates: 'My templates', newContract: 'Create contract', listLabel: 'Contract list', loadError: 'Something went wrong. Please try again shortly.' },
    settings: { title: 'Settings', navLabel: 'Settings menu', branding: 'Branding', language: 'Language', languageTitle: 'Language settings', languageDescription: 'Choose the language used throughout the service.', preference: 'Preferred language', korean: '한국어 (Korean)', english: 'English', previewTitle: 'Live preview', previewDashboard: 'Dashboard', previewEmail: 'Completion email', previewStatus: 'Awaiting signature', previewAction: 'Send new contract', previewEmailSubject: '[Contract completed] Your contract has been signed', cancel: 'Cancel', save: 'Save changes', saving: 'Saving…', saved: 'Language setting saved.', saveFailed: 'We could not save your language setting. Please try again.', retry: 'Try again' },
    wizard: { chooseTitle: 'Create a new contract', chooseSubtitle: 'Choose how you would like to begin.', uploadTitle: 'Upload a PDF', uploadBody: 'Upload a PDF and place signature fields yourself.', templateTitle: 'Start from a template', templateBody: 'Load a saved layout and add recipients to send it right away.', product: 'eSign', exit: 'Exit', exitLabel: 'Exit contract creation' },
    signer: { verifyTitle: 'Verify your identity', verifyHint: 'Enter the 6-digit verification code sent by text message.', codeLabel: 'Verification code', verify: 'Verify identity', verifying: 'Verifying', genericError: 'Something went wrong. Please try again shortly.' },
  },
} as const;

/** A key is open-ended so newly added UI copy is safe before its catalog ships. */
export type WebTranslationKey = `${string}.${string}`;

type TranslationLeaf = string | null | undefined;
export type WebTranslationCatalog = Readonly<Record<string, Readonly<Record<string, TranslationLeaf>>>>;
export type WebTranslationCatalogs = Readonly<Record<SupportedLocale, WebTranslationCatalog>>;

export type MissingWebTranslationReason = 'missing' | 'empty';

/** This report retains keys and counters only, never user data or rendered copy. */
export interface MissingWebTranslationEntry {
  key: WebTranslationKey;
  /** Locale requested by the UI at the point the lookup failed. */
  requestedLocale: SupportedLocale;
  /** Catalog used to safely replace the missing value. */
  fallbackLocale: SupportedLocale;
  reason: MissingWebTranslationReason;
  count: number;
}

export interface WebTranslationFallbackReport {
  /** De-duplicated keys, suitable for a coverage report. */
  missingKeys: readonly WebTranslationKey[];
  /** Per-locale detail and occurrence counts for runtime diagnostics. */
  entries: readonly MissingWebTranslationEntry[];
}

/** Last-resort Korean text when even the Korean base catalog is incomplete. */
export const UNKNOWN_WEB_TRANSLATION_FALLBACK = '내용을 준비하고 있습니다.';

/**
 * Values a copy placeholder may be filled with. Numbers are stringified with the
 * runtime default so callers never have to pre-format simple counts or amounts.
 */
export type InterpolationValue = string | number;
export type InterpolationVars = Readonly<Record<string, InterpolationValue>>;

/**
 * Matches, in a single left-to-right pass: an escaped opening brace `{{`, an
 * escaped closing brace `}}`, or a `{token}` placeholder whose name is a plain
 * identifier. Ordering the escapes first keeps `{{name}}` a literal `{name}`.
 */
const INTERPOLATION_PATTERN = /\{\{|\}\}|\{(\w+)\}/g;

/**
 * Substitutes `{token}` placeholders in `template` with matching `vars`.
 *
 * Standard for browser copy interpolation:
 * - `{name}` is replaced by `vars.name`; numbers are stringified.
 * - A placeholder with no matching var (missing key, `null`, or `undefined`) is
 *   left verbatim as `{name}`, so an omission stays visible instead of turning
 *   into an empty gap or a thrown error.
 * - `{{` and `}}` are escapes for literal `{` and `}`.
 * - Substitution is single pass: a value that itself contains braces is never
 *   re-scanned, so injected copy cannot trigger further interpolation.
 */
export function interpolate(template: string, vars?: InterpolationVars): string {
  if (!vars) return template;
  return template.replace(INTERPOLATION_PATTERN, (match, token: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    const value = vars[token!];
    if (value == null) return match;
    return typeof value === 'number' ? String(value) : value;
  });
}

function lookup(catalog: WebTranslationCatalog | undefined, key: WebTranslationKey): TranslationLeaf {
  const separator = key.indexOf('.');
  if (separator < 1 || separator === key.length - 1) return undefined;
  return catalog?.[key.slice(0, separator)]?.[key.slice(separator + 1)];
}

function missingReason(value: TranslationLeaf): MissingWebTranslationReason | undefined {
  if (value == null) return 'missing';
  if (value.trim() === '') return 'empty';
  return undefined;
}

function isUsableTranslation(value: TranslationLeaf): value is string {
  return !missingReason(value);
}

/**
 * Creates an isolated lookup runtime. Isolated instances keep tests, previews,
 * and coverage jobs independent of the shared browser report.
 */
export function createWebTranslationRuntime(catalogs: WebTranslationCatalogs = WEB_TRANSLATIONS): {
  translate: (locale: SupportedLocale, key: WebTranslationKey, vars?: InterpolationVars) => string;
  getFallbackReport: () => WebTranslationFallbackReport;
  resetFallbackReport: () => void;
} {
  const missing = new Map<string, MissingWebTranslationEntry>();

  const recordMissing = (
    requestedLocale: SupportedLocale,
    key: WebTranslationKey,
    reason: MissingWebTranslationReason,
  ) => {
    const fallbackLocale: SupportedLocale = 'ko';
    const id = `${requestedLocale}\u0000${fallbackLocale}\u0000${key}\u0000${reason}`;
    const previous = missing.get(id);
    if (previous) {
      previous.count += 1;
      return;
    }
    missing.set(id, { key, requestedLocale, fallbackLocale, reason, count: 1 });
  };

  return {
    translate(locale, key, vars) {
      const localized = lookup(catalogs[locale], key);
      if (isUsableTranslation(localized)) return interpolate(localized, vars);

      recordMissing(locale, key, missingReason(localized)!);
      const korean = lookup(catalogs.ko, key);
      return interpolate(isUsableTranslation(korean) ? korean : UNKNOWN_WEB_TRANSLATION_FALLBACK, vars);
    },
    getFallbackReport() {
      const entries = [...missing.values()].map((entry) => ({ ...entry }));
      return {
        missingKeys: [...new Set(entries.map((entry) => entry.key))],
        entries,
      };
    },
    resetFallbackReport() {
      missing.clear();
    },
  };
}

/** Shared browser runtime used by hooks and direct UI translation calls. */
export const webTranslationRuntime = createWebTranslationRuntime();

/**
 * Returns localized copy, Korean base copy, or a safe Korean placeholder—never a
 * key or blank string. Optional `vars` fill `{token}` placeholders in the copy.
 */
export function translateWeb(
  locale: SupportedLocale,
  key: WebTranslationKey,
  vars?: InterpolationVars,
): string {
  return webTranslationRuntime.translate(locale, key, vars);
}

/** Snapshot the missing/empty localized keys replaced by Korean at runtime. */
export function getWebTranslationFallbackReport(): WebTranslationFallbackReport {
  return webTranslationRuntime.getFallbackReport();
}

/** Convenience API for coverage reporters that only need the unique key list. */
export function getMissingWebTranslationKeys(): readonly WebTranslationKey[] {
  return getWebTranslationFallbackReport().missingKeys;
}

/** Clear the shared runtime report, for example after a diagnostics upload. */
export function resetWebTranslationFallbackReport(): void {
  webTranslationRuntime.resetFallbackReport();
}
