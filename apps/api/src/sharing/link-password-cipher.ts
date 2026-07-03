import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';

/**
 * Default link-password encryption secret for local dev. Production MUST set
 * SHARE_LINK_ENCRYPTION_KEY. Intentionally distinct from the JWT / share-session
 * secrets so a leak of one never compromises the others.
 */
export const DEFAULT_SHARE_LINK_ENCRYPTION_KEY = 'dev-local-share-link-key-change-me';

/** Authenticated symmetric cipher — integrity + confidentiality in one pass. */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256-bit key
const IV_LENGTH = 12; // 96-bit nonce (GCM recommended size)
/** Static salt: derives a stable 256-bit key from the configured secret. */
const KEY_DERIVATION_SALT = 'share-link-password-cipher';
/**
 * Self-describing envelope tag. Stored values that start with this are new
 * reversible ciphertext; anything else is a pre-existing (legacy) bcrypt hash,
 * which the verification path still accepts — see {@link isCipherText}.
 */
const CIPHER_PREFIX = 'encv1';

/**
 * Reversible (symmetric) encryption for share-link passwords.
 *
 * The sender needs to review and edit the password they set on a link, so the
 * plaintext must be recoverable — a one-way hash cannot satisfy that. We encrypt
 * with AES-256-GCM under an application secret (never stored in the DB): the DB
 * holds only the ciphertext plus the per-record nonce and auth tag, bundled into
 * one self-describing string `encv1:<iv>:<tag>:<ciphertext>` (all base64).
 *
 * Every record uses a fresh random IV, so identical passwords never yield
 * identical ciphertext, and GCM's auth tag makes tampering detectable on
 * decrypt. The 256-bit key is derived once (scrypt) from the configured secret,
 * so the secret may be any length.
 */
@Injectable()
export class LinkPasswordCipher {
  private cachedKey?: Buffer;

  constructor(private readonly config: ConfigService) {}

  /** Encrypt a plaintext password into the self-describing envelope. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      CIPHER_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /** Recover the original plaintext password from a stored envelope. */
  decrypt(stored: string): string {
    if (!this.isCipherText(stored)) {
      throw new Error('link password is not stored in a recoverable (encrypted) format');
    }
    const [, ivB64, tagB64, ctB64] = stored.split(':');
    const decipher = createDecipheriv(ALGORITHM, this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /**
   * Constant-time check that `candidate` matches the plaintext behind a stored
   * envelope. Only valid for encrypted values — legacy bcrypt hashes are
   * verified by the caller with the hash library (see {@link isCipherText}).
   */
  matches(candidate: string, stored: string): boolean {
    const expected = Buffer.from(this.decrypt(stored), 'utf8');
    const actual = Buffer.from(candidate, 'utf8');
    // Length is not secret; bail before timingSafeEqual (which requires equal
    // lengths) so a length mismatch is simply "wrong password".
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /**
   * True when `stored` is new reversible ciphertext (vs. a legacy bcrypt hash).
   * Lets the verification path route each record to decrypt-compare or
   * hash-compare without a schema flag.
   */
  isCipherText(stored: string): boolean {
    return stored.startsWith(`${CIPHER_PREFIX}:`);
  }

  /** Derive (once) the 256-bit key from the configured application secret. */
  private key(): Buffer {
    if (!this.cachedKey) {
      const secret =
        this.config.get<string>('SHARE_LINK_ENCRYPTION_KEY') ??
        DEFAULT_SHARE_LINK_ENCRYPTION_KEY;
      this.cachedKey = scryptSync(secret, KEY_DERIVATION_SALT, KEY_LENGTH);
    }
    return this.cachedKey;
  }
}
