/**
 * Korean mobile-number normalization + validation.
 *
 * Used by the account-recovery ("find ID") flow so a number typed with spaces,
 * hyphens, or an international prefix maps to one canonical form before it is
 * matched against `User.phoneNumber` (stored canonically) and before a
 * verification code is sent. Kept framework-free so both the DTO transform and
 * the service share a single source of truth.
 */

/**
 * Canonical Korean mobile pattern: `01[0|1|6|7|8|9]` + 7~8 digits.
 * Applied to the normalized (digits-only, domestic `0…`) form.
 */
export const KOREAN_MOBILE_REGEX = /^01[016789]\d{7,8}$/;

/**
 * Normalize a raw mobile-number string to canonical domestic digits.
 *
 *   "+82 10-1234-5678" → "01012345678"
 *   "010 1234 5678"    → "01012345678"
 *   "82-10-1234-5678"  → "01012345678"
 *
 * Strips everything except digits, then rewrites a `+82` / `82` international
 * prefix back to a leading `0`. Returns the cleaned string as-is when it does
 * not look international (validation, not normalization, rejects bad input).
 */
export function normalizeKoreanMobile(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  // International form: 82 + 10xxxxxxxx (the domestic leading 0 is dropped).
  if (digits.startsWith('82')) {
    const rest = digits.slice(2);
    return rest.startsWith('0') ? rest : `0${rest}`;
  }
  return digits;
}

/** True when the value is a valid Korean mobile number after normalization. */
export function isKoreanMobile(raw: string): boolean {
  return KOREAN_MOBILE_REGEX.test(normalizeKoreanMobile(raw));
}
