import type { SupportedLocale } from './locale-resolver';

/** Server-owned copy. New server-facing strings belong here, not in services. */
export const SERVER_TRANSLATIONS = {
  ko: {
    common: { sender: '발신자', signer: '서명자', completed: '완료되었습니다.' },
    signing: {
      invalidLink: '서명 링크가 올바르지 않아요. 발신자에게 링크를 다시 요청해 주세요.',
      completed: '서명이 완료되었습니다!',
    },
    share: {
      invalidLink: '링크가 올바르지 않아요. 보낸 분에게 링크를 다시 요청해 주세요.',
      submitted: '제출이 완료되었습니다!',
    },
    completionEmail: {
      subject: '[{title}] 계약이 모두 완료되었어요',
      headline: '계약이 모두 완료되었어요',
      bodyAllDone: '{title} 계약의 모든 서명이 끝났어요.',
      bodyAttachments:
        '최종 계약서와 감사 추적 인증서를 함께 보내 드려요. 첨부 파일에서 확인하실 수 있어요.',
      bodySenderExtra: '대시보드에서도 언제든 다시 내려받을 수 있어요.',
      finalContract: '최종 계약서',
      finalContractNote: '서명이 모두 담긴 완료본이에요.',
      auditCertificate: '감사 추적 인증서',
      auditCertificateNote: '계약 진행 이력과 문서 무결성을 증명하는 문서예요.',
      ctaLabel: '대시보드에서 보기',
      footer: '이 메일은 계약 완료에 따라 자동으로 발송되었어요.',
      serviceName: '전자계약',
      sender: '발신자',
      logo: '로고',
      attachments: '첨부',
    },
  },
  en: {
    common: { sender: 'Sender', signer: 'Signer', completed: 'Completed.' },
    signing: {
      invalidLink: 'This signing link is invalid. Ask the sender for a new link.',
      completed: 'Signing is complete!',
    },
    share: {
      invalidLink: 'This link is invalid. Ask the sender for a new link.',
      submitted: 'Submission is complete!',
    },
    completionEmail: {
      subject: '[{title}] Contract completed',
      headline: 'Your contract is complete',
      bodyAllDone: 'All signatures for {title} are complete.',
      bodyAttachments:
        'Your final contract and audit trail certificate are attached for your records.',
      bodySenderExtra: 'You can download them again anytime from your dashboard.',
      finalContract: 'Final contract',
      finalContractNote: 'The completed document containing all signatures.',
      auditCertificate: 'Audit trail certificate',
      auditCertificateNote: 'A record of the contract history and document integrity.',
      ctaLabel: 'View dashboard',
      footer: 'This email was sent automatically because the contract was completed.',
      serviceName: 'eContract',
      sender: 'Sender',
      logo: 'logo',
      attachments: 'Attachments',
    },
  },
} as const;

export type TranslationKey =
  | 'common.sender'
  | 'common.signer'
  | 'common.completed'
  | 'signing.invalidLink'
  | 'signing.completed'
  | 'share.invalidLink'
  | 'share.submitted'
  | 'completionEmail.subject'
  | 'completionEmail.headline'
  | 'completionEmail.bodyAllDone'
  | 'completionEmail.bodyAttachments'
  | 'completionEmail.bodySenderExtra'
  | 'completionEmail.finalContract'
  | 'completionEmail.finalContractNote'
  | 'completionEmail.auditCertificate'
  | 'completionEmail.auditCertificateNote'
  | 'completionEmail.ctaLabel'
  | 'completionEmail.footer'
  | 'completionEmail.serviceName'
  | 'completionEmail.sender'
  | 'completionEmail.logo'
  | 'completionEmail.attachments';

/** Returns a translated string, with Korean as the guaranteed safe fallback. */
export function translate(locale: SupportedLocale, key: TranslationKey): string {
  const [scope, name] = key.split('.') as [keyof (typeof SERVER_TRANSLATIONS)['ko'], string];
  const localized = SERVER_TRANSLATIONS[locale][scope] as Record<string, string>;
  const fallback = SERVER_TRANSLATIONS.ko[scope] as Record<string, string>;
  return localized[name] ?? fallback[name];
}
