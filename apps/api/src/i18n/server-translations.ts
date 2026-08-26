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
  },
} as const;

export type TranslationKey =
  | 'common.sender'
  | 'common.signer'
  | 'common.completed'
  | 'signing.invalidLink'
  | 'signing.completed'
  | 'share.invalidLink'
  | 'share.submitted';

/** Returns a translated string, with Korean as the guaranteed safe fallback. */
export function translate(locale: SupportedLocale, key: TranslationKey): string {
  const [scope, name] = key.split('.') as [keyof (typeof SERVER_TRANSLATIONS)['ko'], string];
  const localized = SERVER_TRANSLATIONS[locale][scope] as Record<string, string>;
  const fallback = SERVER_TRANSLATIONS.ko[scope] as Record<string, string>;
  return localized[name] ?? fallback[name];
}
