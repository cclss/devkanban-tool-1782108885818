import { ConfigService } from '@nestjs/config';
import { LinkPasswordCipher } from './link-password-cipher';

/** Build a cipher whose secret is fixed to `key` (or the built-in dev default). */
function makeCipher(key?: string): LinkPasswordCipher {
  const config = {
    get: (name: string) => (name === 'SHARE_LINK_ENCRYPTION_KEY' ? key : undefined),
  } as unknown as ConfigService;
  return new LinkPasswordCipher(config);
}

describe('LinkPasswordCipher', () => {
  it('round-trips a password back to its original plaintext', () => {
    const cipher = makeCipher('a-strong-secret');
    for (const pw of ['secret12', '한글비밀번호', 'p@ss w0rd!', '']) {
      const stored = cipher.encrypt(pw);
      expect(cipher.isCipherText(stored)).toBe(true);
      expect(stored).toContain('encv1:');
      if (pw) expect(stored).not.toContain(pw); // ciphertext hides plaintext
      expect(cipher.decrypt(stored)).toBe(pw);
    }
  });

  it('produces a fresh IV so identical passwords differ in ciphertext', () => {
    const cipher = makeCipher('a-strong-secret');
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same');
    expect(cipher.decrypt(b)).toBe('same');
  });

  it('matches the correct candidate and rejects wrong ones', () => {
    const cipher = makeCipher('a-strong-secret');
    const stored = cipher.encrypt('secret12');
    expect(cipher.matches('secret12', stored)).toBe(true);
    expect(cipher.matches('secret13', stored)).toBe(false);
    expect(cipher.matches('secret12x', stored)).toBe(false); // length mismatch
  });

  it('detects tampering via the GCM auth tag', () => {
    const cipher = makeCipher('a-strong-secret');
    const stored = cipher.encrypt('secret12');
    const [prefix, iv, tag, ct] = stored.split(':');
    // Flip the last base64 char of the ciphertext segment.
    const flipped = ct.slice(0, -1) + (ct.slice(-1) === 'A' ? 'B' : 'A');
    const tampered = [prefix, iv, tag, flipped].join(':');
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('cannot decrypt what a different key encrypted', () => {
    const stored = makeCipher('key-one').encrypt('secret12');
    expect(() => makeCipher('key-two').decrypt(stored)).toThrow();
  });

  it('flags a legacy bcrypt hash as non-ciphertext', () => {
    const cipher = makeCipher('a-strong-secret');
    expect(cipher.isCipherText('$2b$10$abcdefghijklmnopqrstuv')).toBe(false);
  });
});
