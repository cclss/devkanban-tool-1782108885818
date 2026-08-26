import { completionDownloadCopyFor } from './completion-download';
import { signerCopyFor } from './signing';
import { translateWeb } from './web-translations';

const HANGUL = /[\u3131-\uD79D]/;

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves);
  return [];
}

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

  it('keeps the unauthenticated verification screen in English', () => {
    const verificationLabels = [
      'signer.verifyTitle',
      'signer.verifyHint',
      'signer.codeLabel',
      'signer.verify',
      'signer.verifying',
      'signer.genericError',
    ] as const;

    const renderedLabels = verificationLabels.map((key) => translateWeb('en', key));

    expect(renderedLabels).toEqual([
      'Verify your identity',
      'Enter the 6-digit verification code sent by text message.',
      'Verification code',
      'Verify identity',
      'Verifying',
      'Something went wrong. Please try again shortly.',
    ]);
    expect(renderedLabels).not.toEqual(expect.arrayContaining([expect.stringMatching(HANGUL)]));
  });

  it('keeps every static label after verification in English', () => {
    const copy = signerCopyFor('en');

    expect(stringLeaves(copy)).not.toEqual(expect.arrayContaining([expect.stringMatching(HANGUL)]));
    expect(copy.progress(2, 1)).toBe('Completed 1 of 2 signing fields.');
    expect(copy.fieldInputAria(copy.fieldLabel.SIGNATURE)).toBe(
      'Signature field, tap to enter a value',
    );
    expect(copy.done.nextAllDone).toBe(
      'All signatures are complete. We will email the completed contract.',
    );
  });
});
