/**
 * Audit-log `action` code → Korean display label mapping for the audit
 * certificate's event timeline.
 *
 * `AuditLog.action` is a free-form string in the schema. The concrete codes are
 * produced in two places today:
 *   • `documents.service.ts` → `DOCUMENT_UPLOADED`, `CONTRACT_SENT`
 *   • `signing.service.ts`   → `SIGN_REQUEST_VIEWED`, `SIGN_REQUEST_VERIFIED`,
 *                              `SIGN_VERIFY_FAILED`, `SIGN_REQUEST_SIGNED`,
 *                              `DOCUMENT_COMPLETED`
 *
 * The Korean labels follow the tone fixed in the Design Spec `voice.md` (해요체,
 * 명사형 라벨) and the event-type wording listed in the `audit-certificate`
 * component spec (업로드됨/발송됨/열람함/본인확인 완료/서명 완료/계약 완료).
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

/** Code → Korean label. Every known code resolves to a non-fallback label. */
export const AUDIT_ACTION_LABEL: Record<AuditActionCode, string> = {
  [AUDIT_ACTION.DOCUMENT_UPLOADED]: '업로드됨',
  [AUDIT_ACTION.CONTRACT_SENT]: '발송됨',
  [AUDIT_ACTION.SIGN_REQUEST_VIEWED]: '열람함',
  [AUDIT_ACTION.SIGN_REQUEST_VERIFIED]: '본인확인 완료',
  [AUDIT_ACTION.SIGN_VERIFY_FAILED]: '본인확인 실패',
  [AUDIT_ACTION.SIGN_REQUEST_SIGNED]: '서명 완료',
  [AUDIT_ACTION.DOCUMENT_COMPLETED]: '계약 완료',
};

/** Neutral fallback for any future/unknown code — keeps the timeline legible. */
export const AUDIT_ACTION_FALLBACK_LABEL = '기타 활동';

/**
 * Resolve an audit-action code to its Korean label, falling back to a neutral
 * label for unrecognized codes so an unmapped event never blanks the timeline.
 */
export function auditActionLabel(action: string): string {
  return (
    AUDIT_ACTION_LABEL[action as AuditActionCode] ?? AUDIT_ACTION_FALLBACK_LABEL
  );
}
