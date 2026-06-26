/**
 * Password-reset API client.
 *
 * Three-step flow that mirrors the backend contract from grain-3
 * (`apps/api/src/auth/reset-password.*`):
 *
 *   1. `requestResetPassword` — send a 6-digit code to the registered email /
 *      phone. The server answers with the SAME generic acknowledgement whether
 *      or not an account matched (no account enumeration), so the UI never
 *      branches on existence — it just advances to the code step.
 *   2. `verifyResetPassword` — check the code; on success the server mints a
 *      single-use, short-lived reset token and returns it once (`resetToken`).
 *   3. `confirmResetPassword` — present that token plus the new password to set
 *      it. The token is consumed on use, so this can only succeed once.
 *
 * All three surface the server's Toss-tone error copy via `ApiError` (see
 * `api.ts`); the client never invents its own messages.
 */

import { apiFetch } from './api';

/** Where the user is matched and where the code is delivered. */
export type ResetPasswordChannel = 'email' | 'phone';

/** Generic acknowledgement — identical for matched / unmatched targets. */
export interface ResetPasswordRequestResult {
  message: string;
}

export interface ResetPasswordVerifyResult {
  message: string;
  /**
   * High-entropy reset token, returned in plaintext exactly once. The UI holds
   * it in memory and presents it to {@link confirmResetPassword}.
   */
  resetToken: string;
}

export interface ResetPasswordConfirmResult {
  message: string;
}

/**
 * Request a verification code for the given channel + target.
 *
 * `target` is sent as typed (trimmed by the caller); the server normalizes it
 * (lowercases emails, canonicalizes Korean mobile numbers) before matching, so
 * the client never has to. Throws `ApiError` on a bad request / throttle.
 */
export function requestResetPassword(
  channel: ResetPasswordChannel,
  target: string,
): Promise<ResetPasswordRequestResult> {
  return apiFetch<ResetPasswordRequestResult>('/auth/reset-password/request', {
    method: 'POST',
    json: { channel, target },
  });
}

/**
 * Verify the 6-digit code and receive the single-use reset token. Throws
 * `ApiError` on a mismatched / expired code or a temporary lockout — surface
 * `error.message`.
 */
export function verifyResetPassword(
  channel: ResetPasswordChannel,
  target: string,
  code: string,
): Promise<ResetPasswordVerifyResult> {
  return apiFetch<ResetPasswordVerifyResult>('/auth/reset-password/verify', {
    method: 'POST',
    json: { channel, target, code },
  });
}

/**
 * Set the new password using the single-use reset token from
 * {@link verifyResetPassword}.
 *
 * The server's `confirm` DTO requires a `passwordConfirm` that matches
 * `password`; the new-password screen has already validated the two entries
 * match in the UI, so we send `passwordConfirm` equal to `newPassword` here.
 * Throws `ApiError` if the token has expired / already been used or the
 * password fails server-side rules — surface `error.message`.
 */
export function confirmResetPassword(
  resetToken: string,
  newPassword: string,
): Promise<ResetPasswordConfirmResult> {
  return apiFetch<ResetPasswordConfirmResult>('/auth/reset-password/confirm', {
    method: 'POST',
    json: {
      token: resetToken,
      password: newPassword,
      passwordConfirm: newPassword,
    },
  });
}
