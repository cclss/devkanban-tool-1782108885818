import type { SupportedLocale } from './locale';

/** Browser UI catalog. Missing English copy always falls back to Korean. */
export const WEB_TRANSLATIONS = {
  ko: {
    meta: { title: '전자계약', description: '전자계약 SaaS' },
    auth: { product: '전자계약', loginTitle: '다시 오셨네요', loginHint: '이메일과 비밀번호로 로그인해 주세요.', email: '이메일', password: '비밀번호', login: '로그인', loggingIn: '로그인 중', googleLogin: 'Google로 로그인', noAccount: '아직 계정이 없으신가요?', signup: '회원가입', emailRequired: '이메일을 입력해 주세요.', emailInvalid: '이메일 형식을 다시 확인해 주세요.', passwordRequired: '비밀번호를 입력해 주세요.', dividerOr: '또는', passwordShow: '비밀번호 표시', passwordHide: '비밀번호 숨기기' },
    dashboard: { title: '계약', description: '보낸 계약의 진행 상황을 한눈에 확인하세요.', templates: '내 템플릿', newContract: '새 계약 생성', listLabel: '계약 목록', loadError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
    settings: { title: '설정', navLabel: '설정 메뉴', branding: '브랜딩', language: '언어', languageTitle: '언어 설정', languageDescription: '서비스에서 사용할 언어를 선택하세요. 모든 화면에 적용됩니다.', preference: '선호 언어', korean: '한국어 (Korean)', english: 'English', previewTitle: '실시간 미리보기', previewDashboard: '대시보드', previewEmail: '완료 알림 이메일', previewStatus: '서명 대기 중', previewAction: '새 계약 보내기', previewEmailSubject: '[계약 완료] 계약서 서명이 완료되었습니다', cancel: '취소', save: '변경사항 저장', saving: '저장 중…', saved: '언어 설정이 저장되었습니다.', saveFailed: '언어 설정을 저장하지 못했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
    wizard: { chooseTitle: '새 계약을 만들어요', chooseSubtitle: '어떻게 시작할지 골라 주세요.', uploadTitle: '새로 업로드', uploadBody: 'PDF를 올리고 서명 필드를 직접 배치해요.', templateTitle: '내 템플릿에서 시작', templateBody: '저장해 둔 양식을 불러와 수신자만 입력하면 돼요.', product: '전자계약', exit: '나가기', exitLabel: '계약 생성 나가기', pickTitle: '템플릿을 선택해 주세요', pickSubtitle: '고르면 PDF와 필드 배치를 그대로 불러와요. 수신자만 입력하면 바로 발송할 수 있어요.', pickBack: '뒤로', pickListLabel: '템플릿 목록', pickSelectLabel: '{name} 템플릿으로 시작', pickEmptyTitle: '아직 저장한 템플릿이 없어요', pickEmptyBody: '자주 쓰는 양식을 템플릿으로 저장해 두면, 다음부터는 필드 배치 없이 바로 발송할 수 있어요.', pickEmptyCta: '새로 업로드', preparingTitle: '템플릿을 불러오고 있어요', preparingBody: 'PDF와 필드 배치를 준비하고 있어요. 잠시만 기다려 주세요.', retry: '다시 시도', startOver: '다른 방법으로 시작' },
    signer: { verifyTitle: '본인확인', verifyHint: '문자로 받은 6자리 인증 코드를 입력해 주세요.', codeLabel: '인증 코드', verify: '본인확인', verifying: '확인 중', genericError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
    templates: { title: '내 템플릿', description: '저장해 둔 양식을 모아 봐요. 새 계약을 만들 때 바로 불러올 수 있어요.', listLabel: '템플릿 목록', emptyTitle: '아직 저장한 템플릿이 없어요', emptyDescription: '자주 쓰는 양식을 템플릿으로 저장해 두면, 다음부터는 필드 배치 없이 바로 발송할 수 있어요.', emptyCta: '새 계약 만들기', errorRetry: '다시 시도', start: '이 템플릿으로 시작', preview: '미리보기', rename: '이름 수정', delete: '삭제', actionsLabel: '{name} 관리', renameTitle: '템플릿 이름 수정', renameDescription: '목록에서 찾기 쉬운 이름으로 바꿔 주세요.', renameNameLabel: '템플릿 이름', renameNamePlaceholder: '예: 표준 근로계약서', renameCancel: '취소', renameSave: '저장', renameSaving: '저장 중', deleteTitle: "'{name}'을(를) 삭제할까요?", deleteDescription: '삭제하면 되돌릴 수 없어요. 이미 발송한 계약에는 영향을 주지 않아요.', deleteCancel: '취소', deleteConfirm: '삭제', deleting: '삭제 중', previewTitle: '{name} 미리보기', previewDescription: '저장된 서명·날짜·텍스트란이 PDF 어디에 놓이는지 확인해 보세요. 미리보기는 템플릿을 바꾸지 않아요.', previewLoading: '미리보기를 불러오고 있어요.', previewError: '미리보기를 불러오지 못했어요.', previewRetry: '다시 시도', previewClose: '닫기', renameFailed: '이름을 바꾸지 못해 원래대로 되돌렸어요.', deleteFailed: '삭제하지 못해 목록에 다시 넣었어요.', metaPages: '{n}페이지', metaFields: '필드 {n}개', savedSuffix: '저장', fpPageLabel: '템플릿 {page}/{total}페이지 미리보기', fpPrevPage: '이전 페이지', fpNextPage: '다음 페이지', fpPageIndicator: '{page} / {total}', fpLegendLabel: '필드 종류', fpRecipientBadge: '수신자 {n}', fpRecipientHint: '박스 왼쪽 위 숫자는 서명할 수신자 순서예요.', fpNoFieldsOnPage: '이 페이지에는 배치된 필드가 없어요.', fpLoading: '미리보기를 불러오고 있어요.', fpError: 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.' },
    branding: { title: '브랜딩', description: '로고, 파비콘, 대표 색상을 설정해 서비스 전반에 우리 브랜드를 입혀요.', logoLabel: '로고', faviconLabel: '파비콘', logoSetHint: '지금 설정된 로고가 있어요. 새 SVG 또는 PNG(최대 1MB)를 올리면 바뀌어요.', faviconSetHint: '지금 설정된 파비콘이 있어요. 새 SVG 또는 PNG(최대 1MB)를 올리면 바뀌어요.', save: '저장', cancel: '취소', savedNotice: '브랜딩 설정을 저장했어요. 서비스 전반에 바로 반영했어요.', colorLabel: '대표 색상', colorHint: '버튼·링크 같은 주요 요소에 쓰일 색이에요. #163AF2처럼 색상 코드를 입력하거나 색상판에서 골라요.', colorInvalidHex: '색상 코드를 확인해 주세요. #163AF2처럼 3자리 또는 6자리로 입력해요.', colorSwatchLabel: '색상판에서 대표 색상 고르기', colorPreviewLabel: '미리보기', colorPreviewButton: '서명 요청 보내기', colorPreviewLink: '계약서 미리보기', previewTitle: '미리보기', previewDescription: '고른 로고·파비콘·색상이 서비스에 어떻게 보일지 저장 전에 확인해요.', previewHeaderLabel: '헤더', previewTabLabel: '브라우저 탭', previewColorLabel: '강조 색상', previewLogoAlt: '로고 미리보기', previewFaviconAlt: '파비콘 미리보기' },
    header: { wordmark: '전자계약', logoAlt: '전자계약 로고', languageSwitchLabel: '언어 선택', localeKo: '한국어', localeEn: 'English', logout: '로그아웃' },
    time: { justNow: '방금 전', minutesAgo: '{n}분 전', hoursAgo: '{n}시간 전', daysAgo: '{n}일 전' },
    contract: { metaRecipients: '받는 분 {n}명', metaPages: '{n}페이지', metaSent: '{when} 발송', metaCreated: '{when} 생성' },
    imageUploader: { chooseAnother: '다른 파일', remove: '제거', currentLabel: '현재 설정된 {label}', currentImage: '현재 설정된 이미지', replaceHint: '새로 올리면 교체돼요', dropActive: '여기에 놓으면 올라가요', dragLabeled: '{label} 이미지를 끌어다 놓으세요', dragUnlabeled: '이미지를 끌어다 놓으세요', orClick: '또는 클릭해서 파일을 선택하세요', chooseFile: '파일 선택' },
    onboarding: { title: '3단계로 첫 계약을 보내요', description: '이렇게 계약서를 보내고 서명을 받을 수 있어요. 준비되면 첫 계약을 만들어 보세요.', step1Title: '계약서 올리기', step1Description: '서명받을 PDF 계약서를 업로드해요.', step2Title: '서명 요청 보내기', step2Description: '받는 분에게 서명 위치를 지정하고 발송해요.', step3Title: '완료까지 추적하기', step3Description: '서명 요청부터 완료까지 대시보드에서 한눈에 확인해요.', cta: '첫 계약 만들기' },
    todo: { urgencyOverdue: '기한 초과', urgencyDueSoon: '마감 임박', nextSendDraft: '발송하기', nextAwaitingSign: '서명 대기 중', nextDownload: '내려받기', pendingSigners: '서명 대기 {count}명', summaryOverdue: '기한 초과', summaryDueSoon: '마감 임박', summaryAwaiting: '서명 대기 중', countUnit: '건', filteredEmpty: '이 조건에 해당하는 계약이 없어요.', filteredClear: '전체 보기', viewList: '목록', viewKanban: '칸반', viewGroupLabel: '뷰 전환', columnDraft: '작성 중', columnScheduled: '예약됨', columnInProgress: '진행 중', columnCompleted: '완료됨', columnCancelled: '취소됨', emptyColumn: '이 상태의 계약이 없어요.', boardLabel: '칸반 보드' },
    recipients: { emailRequired: '이메일을 입력해 주세요.', emailInvalid: '이메일 형식을 다시 확인해 주세요.', emailDuplicate: '이미 추가된 이메일이에요.', label: '받는 분 {n}' },
    share: { gateTitle: '비밀번호를 입력해 주세요', gateHint: '이 계약서는 비밀번호로 보호되어 있어요.', gateLabel: '비밀번호', gatePlaceholder: '비밀번호를 입력해 주세요', gateSubmit: '확인', gateSubmitting: '확인 중', gateTooShort: '비밀번호는 {min}자 이상으로 입력해 주세요.', gateError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.', noticeExpiredTitle: '링크가 만료됐어요', noticeExpiredBody: '이 링크는 유효 기간이 지났어요. 보낸 분에게 새 링크를 요청해 주세요.', noticeDisabledTitle: '지금은 열 수 없는 링크예요', noticeDisabledBody: '보낸 분이 이 링크를 사용 중지했어요. 보낸 분에게 문의해 주세요.', noticeInvalidLinkTitle: '링크를 확인해 주세요', noticeInvalidLinkBody: '링크가 올바르지 않아요. 보낸 분에게 링크를 다시 요청해 주세요.', noticeNotSignableTitle: '지금은 작성할 수 없어요', noticeNotSignableBody: '지금은 작성할 수 없는 계약이에요. 보낸 분에게 문의해 주세요.', noticeAlreadySubmittedTitle: '이미 제출했어요', noticeAlreadySubmittedBody: '이미 제출을 완료한 계약이에요.', viewerContinue: '작성하기', viewerComplete: '제출하기', viewerLoadError: '문서를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.', viewerProgressNone: '작성할 항목이 없어요.', viewerProgressAllDone: '모든 항목을 작성했어요.', viewerCompleteError: '제출하지 못했어요. 잠시 후 다시 시도해 주세요.', viewerPageError: '{page}페이지를 불러올 수 없어요.', viewerProgress: '작성할 항목 {total}곳 중 {done}곳을 작성했어요.', viewerDateHint: '날짜를 입력해 주세요.', viewerTextHint: '내용을 입력해 주세요.', doneTitle: '제출이 완료되었습니다!', doneBody: '작성하신 내용이 안전하게 전달됐어요.', doneDocumentLabel: '제출한 문서', doneNext: '보낸 분이 확인할 수 있도록 전달했어요. 이제 창을 닫으셔도 돼요.' },
    common: { cancel: '취소', save: '저장', retry: '다시 시도', close: '닫기', genericError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' },
  },
  en: {
    meta: { title: 'eSign', description: 'Electronic contract SaaS' },
    auth: { product: 'eSign', loginTitle: 'Welcome back', loginHint: 'Sign in with your email and password.', email: 'Email', password: 'Password', login: 'Sign in', loggingIn: 'Signing in', googleLogin: 'Continue with Google', noAccount: 'New here?', signup: 'Create an account', emailRequired: 'Enter your email address.', emailInvalid: 'Check your email address.', passwordRequired: 'Enter your password.', dividerOr: 'or', passwordShow: 'Show password', passwordHide: 'Hide password' },
    dashboard: { title: 'Contracts', description: 'Track the progress of contracts you have sent.', templates: 'My templates', newContract: 'Create contract', listLabel: 'Contract list', loadError: 'Something went wrong. Please try again shortly.' },
    settings: { title: 'Settings', navLabel: 'Settings menu', branding: 'Branding', language: 'Language', languageTitle: 'Language settings', languageDescription: 'Choose the language used throughout the service.', preference: 'Preferred language', korean: '한국어 (Korean)', english: 'English', previewTitle: 'Live preview', previewDashboard: 'Dashboard', previewEmail: 'Completion email', previewStatus: 'Awaiting signature', previewAction: 'Send new contract', previewEmailSubject: '[Contract completed] Your contract has been signed', cancel: 'Cancel', save: 'Save changes', saving: 'Saving…', saved: 'Language setting saved.', saveFailed: 'We could not save your language setting. Please try again.', retry: 'Try again' },
    wizard: { chooseTitle: 'Create a new contract', chooseSubtitle: 'Choose how you would like to begin.', uploadTitle: 'Upload a PDF', uploadBody: 'Upload a PDF and place signature fields yourself.', templateTitle: 'Start from a template', templateBody: 'Load a saved layout and add recipients to send it right away.', product: 'eSign', exit: 'Exit', exitLabel: 'Exit contract creation', pickTitle: 'Choose a template', pickSubtitle: 'Selecting one loads its PDF and field layout as-is. Just add recipients to send right away.', pickBack: 'Back', pickListLabel: 'Template list', pickSelectLabel: 'Start with the {name} template', pickEmptyTitle: 'No saved templates yet', pickEmptyBody: 'Save the layouts you use often as templates, and next time you can send without placing fields again.', pickEmptyCta: 'Upload a PDF', preparingTitle: 'Loading the template', preparingBody: 'Preparing the PDF and field layout. This will only take a moment.', retry: 'Try again', startOver: 'Start another way' },
    signer: { verifyTitle: 'Verify your identity', verifyHint: 'Enter the 6-digit verification code sent by text message.', codeLabel: 'Verification code', verify: 'Verify identity', verifying: 'Verifying', genericError: 'Something went wrong. Please try again shortly.' },
    templates: { title: 'My templates', description: 'A collection of your saved layouts. Load one instantly when creating a new contract.', listLabel: 'Template list', emptyTitle: 'No saved templates yet', emptyDescription: 'Save the layouts you use often as templates, and next time you can send without placing fields again.', emptyCta: 'Create a contract', errorRetry: 'Try again', start: 'Start with this template', preview: 'Preview', rename: 'Rename', delete: 'Delete', actionsLabel: 'Manage {name}', renameTitle: 'Rename template', renameDescription: "Give it a name that's easy to find in the list.", renameNameLabel: 'Template name', renameNamePlaceholder: 'e.g. Standard employment contract', renameCancel: 'Cancel', renameSave: 'Save', renameSaving: 'Saving', deleteTitle: "Delete '{name}'?", deleteDescription: "This can't be undone. Contracts you've already sent are unaffected.", deleteCancel: 'Cancel', deleteConfirm: 'Delete', deleting: 'Deleting', previewTitle: '{name} preview', previewDescription: 'Check where the saved signature, date, and text fields sit on the PDF. Previewing never changes the template.', previewLoading: 'Loading the preview.', previewError: "We couldn't load the preview.", previewRetry: 'Try again', previewClose: 'Close', renameFailed: "We couldn't rename it, so we restored the original name.", deleteFailed: "We couldn't delete it, so we put it back in the list.", metaPages: '{n} pages', metaFields: '{n} fields', savedSuffix: 'saved', fpPageLabel: 'Template preview, page {page} of {total}', fpPrevPage: 'Previous page', fpNextPage: 'Next page', fpPageIndicator: '{page} / {total}', fpLegendLabel: 'Field types', fpRecipientBadge: 'Recipient {n}', fpRecipientHint: 'The number at the top-left of each box is the signing order of that recipient.', fpNoFieldsOnPage: 'No fields are placed on this page.', fpLoading: 'Loading the preview.', fpError: "We can't read the PDF. Check that the file isn't damaged." },
    branding: { title: 'Branding', description: 'Set your logo, favicon, and brand color to apply your brand across the service.', logoLabel: 'Logo', faviconLabel: 'Favicon', logoSetHint: 'A logo is currently set. Upload a new SVG or PNG (up to 1MB) to replace it.', faviconSetHint: 'A favicon is currently set. Upload a new SVG or PNG (up to 1MB) to replace it.', save: 'Save', cancel: 'Cancel', savedNotice: "Branding settings saved. They're now applied across the service.", colorLabel: 'Brand color', colorHint: 'The color used for key elements like buttons and links. Enter a color code like #163AF2 or pick one from the palette.', colorInvalidHex: 'Check the color code. Enter 3 or 6 digits like #163AF2.', colorSwatchLabel: 'Pick the brand color from the palette', colorPreviewLabel: 'Preview', colorPreviewButton: 'Send signature request', colorPreviewLink: 'Preview contract', previewTitle: 'Preview', previewDescription: 'See how your logo, favicon, and color will look across the service before saving.', previewHeaderLabel: 'Header', previewTabLabel: 'Browser tab', previewColorLabel: 'Accent color', previewLogoAlt: 'Logo preview', previewFaviconAlt: 'Favicon preview' },
    header: { wordmark: 'eSign', logoAlt: 'eSign logo', languageSwitchLabel: 'Select language', localeKo: '한국어', localeEn: 'English', logout: 'Sign out' },
    time: { justNow: 'Just now', minutesAgo: '{n}m ago', hoursAgo: '{n}h ago', daysAgo: '{n}d ago' },
    contract: { metaRecipients: '{n} recipients', metaPages: '{n} pages', metaSent: 'Sent {when}', metaCreated: 'Created {when}' },
    imageUploader: { chooseAnother: 'Choose another file', remove: 'Remove', currentLabel: 'Current {label}', currentImage: 'Current image', replaceHint: 'Uploading a new one replaces it', dropActive: 'Drop to upload', dragLabeled: 'Drag {label} image here', dragUnlabeled: 'Drag an image here', orClick: 'or click to choose a file', chooseFile: 'Choose file' },
    onboarding: { title: 'Send your first contract in 3 steps', description: "Here's how to send a contract and collect signatures. When you're ready, create your first one.", step1Title: 'Upload the contract', step1Description: 'Upload the PDF contract you want signed.', step2Title: 'Request a signature', step2Description: 'Mark where recipients should sign, then send it.', step3Title: 'Track to completion', step3Description: 'Follow everything from request to completion, all on the dashboard.', cta: 'Create your first contract' },
    todo: { urgencyOverdue: 'Overdue', urgencyDueSoon: 'Due soon', nextSendDraft: 'Send', nextAwaitingSign: 'Awaiting signature', nextDownload: 'Download', pendingSigners: '{count} awaiting signature', summaryOverdue: 'Overdue', summaryDueSoon: 'Due soon', summaryAwaiting: 'Awaiting signature', countUnit: ' contracts', filteredEmpty: 'No contracts match this filter.', filteredClear: 'Show all', viewList: 'List', viewKanban: 'Kanban', viewGroupLabel: 'Switch view', columnDraft: 'Draft', columnScheduled: 'Scheduled', columnInProgress: 'In progress', columnCompleted: 'Completed', columnCancelled: 'Cancelled', emptyColumn: 'No contracts in this status.', boardLabel: 'Kanban board' },
    recipients: { emailRequired: 'Enter an email address.', emailInvalid: 'Check the email format.', emailDuplicate: 'This email is already added.', label: 'Recipient {n}' },
    share: { gateTitle: 'Enter the password', gateHint: 'This contract is password protected.', gateLabel: 'Password', gatePlaceholder: 'Enter the password', gateSubmit: 'Continue', gateSubmitting: 'Checking…', gateTooShort: 'Enter at least {min} characters.', gateError: 'Something went wrong. Please try again shortly.', noticeExpiredTitle: 'This link has expired', noticeExpiredBody: 'This link is no longer valid. Ask the sender for a new link.', noticeDisabledTitle: 'This link is unavailable', noticeDisabledBody: 'The sender has disabled this link. Contact the sender for help.', noticeInvalidLinkTitle: 'Check your link', noticeInvalidLinkBody: 'This link is invalid. Ask the sender to send it again.', noticeNotSignableTitle: 'This contract cannot be completed', noticeNotSignableBody: 'This contract is not available right now. Contact the sender.', noticeAlreadySubmittedTitle: 'Already submitted', noticeAlreadySubmittedBody: 'You have already submitted this contract.', viewerContinue: 'Continue', viewerComplete: 'Submit', viewerLoadError: 'We could not load the document. Please try again shortly.', viewerProgressNone: 'There are no fields to complete.', viewerProgressAllDone: 'All fields are complete.', viewerCompleteError: 'We could not submit your response. Please try again shortly.', viewerPageError: 'We could not load page {page}.', viewerProgress: 'Completed {done} of {total} fields.', viewerDateHint: 'Enter the date.', viewerTextHint: 'Enter the required information.', doneTitle: 'Submission complete!', doneBody: 'Your response has been delivered securely.', doneDocumentLabel: 'Submitted document', doneNext: 'The sender can now review your response. You may close this window.' },
    common: { cancel: 'Cancel', save: 'Save', retry: 'Try again', close: 'Close', genericError: 'Something went wrong. Please try again shortly.' },
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
 * Standard for browser copy interpolation (this is the contract callers rely on):
 * - Token syntax is `{name}`: the name must be a plain identifier (`\w+`, i.e.
 *   ASCII letters, digits, or `_`). A brace run that is not a valid token —
 *   e.g. `{full-name}` or a non-ASCII name like `{이름}` — is left literal.
 * - Multiple variables: every `{token}` in the template is filled independently
 *   from its own `vars` entry in one pass, so `"{name} → {count}"` resolves both
 *   `name` and `count` regardless of order or repetition.
 * - `{name}` is replaced by `vars.name`; numbers are stringified.
 * - Missing variable: a placeholder with no matching var (key absent, `null`, or
 *   `undefined`) is left verbatim as `{name}`, so an omission stays visible
 *   instead of turning into an empty gap or a thrown error.
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
  const warned = new Set<WebTranslationKey>();

  /**
   * Surfaces the first fallback for each key while developing, so gaps are noticed
   * before shipping. Reports only the key, requested locale, and reason—never the
   * rendered copy or interpolation vars—so no user data reaches the console. Muted
   * in production, where the structured fallback report is the diagnostics channel.
   */
  const warnOnceInDev = (
    requestedLocale: SupportedLocale,
    fallbackLocale: SupportedLocale,
    key: WebTranslationKey,
    reason: MissingWebTranslationReason,
  ) => {
    if (process.env.NODE_ENV === 'production') return;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(
      `[web-translations] Missing copy for "${key}" (locale "${requestedLocale}", ${reason}); using "${fallbackLocale}" fallback.`,
    );
  };

  const recordMissing = (
    requestedLocale: SupportedLocale,
    key: WebTranslationKey,
    reason: MissingWebTranslationReason,
  ) => {
    const fallbackLocale: SupportedLocale = 'ko';
    warnOnceInDev(requestedLocale, fallbackLocale, key, reason);
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
      warned.clear();
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
