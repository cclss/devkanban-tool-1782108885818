import type { SupportedLocale } from '../i18n/locale-resolver';
import { translate, type TranslationKey } from '../i18n/server-translations';

/**
 * Audit-log `action` code → locale-specific display label mapping for the
 * audit certificate's event timeline.
 *
 * `AuditLog.action` is a free-form string in the schema. The concrete codes are
 * produced in two places today:
 *   • `documents.service.ts` → `DOCUMENT_UPLOADED`, `CONTRACT_SENT`
 *   • `signing.service.ts`   → `SIGN_REQUEST_VIEWED`, `SIGN_REQUEST_VERIFIED`,
 *                              `SIGN_VERIFY_FAILED`, `SIGN_REQUEST_SIGNED`,
 *                              `DOCUMENT_COMPLETED`
 *
 * Each label is kept in the server translation resources alongside the other
 * user-facing completion output copy.
 */

/** Canonical persisted audit-action codes (mirrors the emit sites above). */
export const AUDIT_ACTION = {
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  CONTRACT_SENT: 'CONTRACT_SENT',
  SIGN_REQUEST_VIEWED: 'SIGN_REQUEST_VIEWED',
  SIGN_REQUEST_VERIFIED: 'SIGN_REQUEST_VERIFIED',
  SIGN_VERIFY_FAILED: 'SIGN_VERIFY_FAILED',
  SIGN_REQUEST_SIGNED: 'SIGN_REQUEST_SIGNED',
  DOCUMENT_COMPLETED: 'DOCUMENT_COMPLETED',
} as const;

export type AuditActionCode = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** Code → translation key. Every known code resolves to a non-fallback label. */
export const AUDIT_ACTION_LABEL: Record<AuditActionCode, TranslationKey> = {
  [AUDIT_ACTION.DOCUMENT_UPLOADED]: 'auditCertificate.actionDocumentUploaded',
  [AUDIT_ACTION.CONTRACT_SENT]: 'auditCertificate.actionContractSent',
  [AUDIT_ACTION.SIGN_REQUEST_VIEWED]: 'auditCertificate.actionSignRequestViewed',
  [AUDIT_ACTION.SIGN_REQUEST_VERIFIED]: 'auditCertificate.actionSignRequestVerified',
  [AUDIT_ACTION.SIGN_VERIFY_FAILED]: 'auditCertificate.actionSignVerifyFailed',
  [AUDIT_ACTION.SIGN_REQUEST_SIGNED]: 'auditCertificate.actionSignRequestSigned',
  [AUDIT_ACTION.DOCUMENT_COMPLETED]: 'auditCertificate.actionDocumentCompleted',
};

/** Neutral fallback for any future/unknown code — keeps the timeline legible. */
export const AUDIT_ACTION_FALLBACK_LABEL = 'auditCertificate.actionFallback' as const;

/**
 * Resolve an audit-action code to its localized label, falling back to a neutral
 * label for unrecognized codes so an unmapped event never blanks the timeline.
 */
export function auditActionLabel(locale: SupportedLocale, action: string): string {
  return translate(
    locale,
    AUDIT_ACTION_LABEL[action as AuditActionCode] ?? AUDIT_ACTION_FALLBACK_LABEL,
  );
}
