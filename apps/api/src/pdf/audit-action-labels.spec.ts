import {
  AUDIT_ACTION,
  AUDIT_ACTION_FALLBACK_LABEL,
  auditActionLabel,
} from './audit-action-labels';

describe('auditActionLabel', () => {
  it('maps every known audit-action code to a non-fallback localized label', () => {
    for (const code of Object.values(AUDIT_ACTION)) {
      const label = auditActionLabel('ko', code);
      expect(label).not.toBe(auditActionLabel('ko', 'UNKNOWN'));
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('renders the full contract lifecycle in English', () => {
    expect(auditActionLabel('en', AUDIT_ACTION.DOCUMENT_UPLOADED)).toBe('Document uploaded');
    expect(auditActionLabel('en', AUDIT_ACTION.CONTRACT_SENT)).toBe('Contract sent');
    expect(auditActionLabel('en', AUDIT_ACTION.SIGN_REQUEST_VIEWED)).toBe('Signing request viewed');
    expect(auditActionLabel('en', AUDIT_ACTION.SIGN_REQUEST_VERIFIED)).toBe('Identity verified');
    expect(auditActionLabel('en', AUDIT_ACTION.SIGN_VERIFY_FAILED)).toBe('Identity verification failed');
    expect(auditActionLabel('en', AUDIT_ACTION.SIGN_REQUEST_SIGNED)).toBe('Signing completed');
    expect(auditActionLabel('en', AUDIT_ACTION.DOCUMENT_COMPLETED)).toBe('Contract completed');
  });

  it('falls back to a neutral label for unknown codes', () => {
    expect(auditActionLabel('en', 'SOME_FUTURE_ACTION')).toBe('Other activity');
    expect(auditActionLabel('ko', '')).toBe('기타 활동');
    expect(AUDIT_ACTION_FALLBACK_LABEL).toBe('auditCertificate.actionFallback');
  });
});
