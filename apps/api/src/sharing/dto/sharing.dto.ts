import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  SHARE_LINK_MAX_EXPIRY_DAYS,
} from '../../common/messages';

/** Lower bound for a link password (kept lenient — senders pick short codes). */
export const SHARE_PASSWORD_MIN_LENGTH = 4;
/** Upper bound for a link password. */
export const SHARE_PASSWORD_MAX_LENGTH = 128;
/** Upper bound for a sender-facing link label. */
export const SHARE_LABEL_MAX_LENGTH = 60;

/**
 * Create a share link for a document.
 *
 * Expiry: `noExpiry: true` ⇒ the link never expires; otherwise `expiresInDays`
 * (default applied in the service) sets the window. Password: when provided it
 * is hashed at rest — the plaintext is never persisted, returned, or logged.
 */
export class CreateShareLinkDto {
  /** Set true for "만료 없음" (no expiry). Mutually exclusive with a window. */
  @IsOptional()
  @IsBoolean()
  noExpiry?: boolean;

  /** Validity window in days. Ignored when `noExpiry` is true. */
  @ValidateIf((o: CreateShareLinkDto) => !o.noExpiry && o.expiresInDays !== undefined)
  @IsInt()
  @Min(1)
  @Max(SHARE_LINK_MAX_EXPIRY_DAYS)
  expiresInDays?: number;

  /** Optional access password. Omit/empty ⇒ no password required. */
  @IsOptional()
  @IsString()
  @MinLength(SHARE_PASSWORD_MIN_LENGTH)
  @MaxLength(SHARE_PASSWORD_MAX_LENGTH)
  password?: string;

  /** Optional sender-facing label to tell multiple links apart. */
  @IsOptional()
  @IsString()
  @MaxLength(SHARE_LABEL_MAX_LENGTH)
  label?: string;
}

/** Unlock a password-protected share link → short-lived share session token. */
export class UnlockShareLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(SHARE_PASSWORD_MAX_LENGTH)
  password?: string;
}

/**
 * Replace (or clear) a share link's access password from the sender dashboard.
 *
 * PUT semantics — the body describes the desired password state:
 *   - a non-empty value ⇒ set/replace it (stored as reversible ciphertext);
 *   - omitted / null / empty ⇒ remove password protection.
 * Length is enforced only when a non-empty value is supplied, matching create.
 */
export class UpdateShareLinkPasswordDto {
  @IsOptional()
  @ValidateIf((o: UpdateShareLinkPasswordDto) => o.password != null && o.password !== '')
  @IsString()
  @MinLength(SHARE_PASSWORD_MIN_LENGTH)
  @MaxLength(SHARE_PASSWORD_MAX_LENGTH)
  password?: string | null;
}
