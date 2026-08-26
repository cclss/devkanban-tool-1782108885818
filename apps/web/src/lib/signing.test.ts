import { completionDownloadCopyFor } from './completion-download';
import { signerCopyFor } from './signing';

describe('external signer English copy', () => {
  it('provides English chrome from verification through signature completion', () => {
    const copy = signerCopyFor('en');

    expect(copy.verifyTitle).toBe('Verify your identity');
    expect(copy.viewerCtaContinue).toBe('Sign');
    expect(copy.fieldAffordance.SIGNATURE).toBe('Sign here');
    expect(copy.sheet.apply).toBe('Apply');
    expect(copy.done.title).toBe('Signing complete!');
  });

  it('provides English completion-download labels for a public signer', () => {
    const copy = completionDownloadCopyFor('en');

    expect(copy.sectionTitle).toBe('Completed documents');
    expect(copy.items.signed.title).toBe('Signed contract');
    expect(copy.items.certificate.title).toBe('Audit trail certificate');
    expect(copy.cta).toBe('Download');
  });
});
