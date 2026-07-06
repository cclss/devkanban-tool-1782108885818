import {
  AUDIT_ACTION,
  AUDIT_ACTION_FALLBACK_LABEL,
  AUDIT_ACTION_LABEL,
  auditActionLabel,
} from './audit-action-labels';

describe('auditActionLabel', () => {
  it('maps every known audit-action code to a non-fallback Korean label', () => {
    for (const code of Object.values(AUDIT_ACTION)) {
      const label = auditActionLabel(code);
      expect(label).toBe(AUDIT_ACTION_LABEL[code]);
      expect(label).not.toBe(AUDIT_ACTION_FALLBACK_LABEL);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('covers the full contract lifecycle wording (생성·발송·열람·본인확인·서명·완료)', () => {
    expect(auditActionLabel(AUDIT_ACTION.DOCUMENT_UPLOADED)).toBe('업로드됨');
    expect(auditActionLabel(AUDIT_ACTION.CONTRACT_SENT)).toBe('발송됨');
    expect(auditActionLabel(AUDIT_ACTION.SIGN_REQUEST_VIEWED)).toBe('열람함');
    expect(auditActionLabel(AUDIT_ACTION.SIGN_REQUEST_VERIFIED)).toBe('본인확인 완료');
    expect(auditActionLabel(AUDIT_ACTION.SIGN_VERIFY_FAILED)).toBe('본인확인 실패');
    expect(auditActionLabel(AUDIT_ACTION.SIGN_REQUEST_SIGNED)).toBe('서명 완료');
    expect(auditActionLabel(AUDIT_ACTION.DOCUMENT_COMPLETED)).toBe('계약 완료');
  });

  it('falls back to a neutral label for unknown codes', () => {
    expect(auditActionLabel('SOME_FUTURE_ACTION')).toBe(AUDIT_ACTION_FALLBACK_LABEL);
    expect(auditActionLabel('')).toBe(AUDIT_ACTION_FALLBACK_LABEL);
  });
});
