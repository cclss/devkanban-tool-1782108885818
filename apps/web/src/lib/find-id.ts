/**
 * Account-recovery ("아이디 찾기") API client.
 *
 * Two-step, code-based identity check that mirrors the backend contract from
 * grain-2 (`apps/api/src/auth/find-id.*`):
 *
 *   1. `requestFindId` — send a 6-digit code to the registered email / phone.
 *      The server answers with the SAME generic acknowledgement whether or not
 *      an account matched (no account enumeration), so the UI never branches on
 *      existence — it just advances to the code step.
 *   2. `verifyFindId` — check the code; on success the full ID is delivered out
 *      of band (email/SMS) and the response carries only a MASKED id to show.
 *
 * Both surface the server's Toss-tone error copy via `ApiError` (see `api.ts`).
 */

import { apiFetch } from './api';

/** Where the user is matched and where the code is delivered. */
export type FindIdChannel = 'email' | 'phone';

/** Generic acknowledgement — identical for matched / unmatched targets. */
export interface FindIdRequestResult {
  message: string;
}

export interface FindIdVerifyResult {
  message: string;
  /** Masked recovered ID (e.g. `ho***@example.com`); the full ID is sent out of band. */
  maskedId: string;
}

/**
 * Request a verification code for the given channel + target.
 *
 * `target` is sent as typed (trimmed by the caller); the server normalizes it
 * (lowercases emails, canonicalizes Korean mobile numbers) before matching, so
 * the client never has to. Throws `ApiError` on a bad request / throttle.
 */
export function requestFindId(
  channel: FindIdChannel,
  target: string,
): Promise<FindIdRequestResult> {
  return apiFetch<FindIdRequestResult>('/auth/find-id/request', {
    method: 'POST',
    json: { channel, target },
  });
}

/**
 * Verify the 6-digit code and recover the (masked) ID. Throws `ApiError` on a
 * mismatched / expired code or a temporary lockout — surface `error.message`.
 */
export function verifyFindId(
  channel: FindIdChannel,
  target: string,
  code: string,
): Promise<FindIdVerifyResult> {
  return apiFetch<FindIdVerifyResult>('/auth/find-id/verify', {
    method: 'POST',
    json: { channel, target, code },
  });
}
