/**
 * Recipient-side API client for the public link-share flow.
 *
 * Wraps the JWT-free `/share/:token/...` endpoints (see
 * `apps/api/src/sharing/share-public.controller.ts`). Response shapes mirror the
 * server's DTOs so the recipient UI binds to them directly. `:token` is the LINK
 * SignRequest access token embedded in the share link.
 *
 * The short-lived *share session* token (issued on `/unlock`) is the bearer for
 * the session-guarded calls. It is persisted per access token in `sessionStorage`
 * (a separate `esign.share.` namespace from the OTP signer's `esign.signer.`) so a
 * reload inside the same tab can resume, while it never outlives the tab.
 *
 * User-facing access/error copy is owned by the server (`MESSAGES.share`) and
 * surfaced verbatim through `ApiError`. The screen chrome authored client-side
 * lives in `SHARE_RECIPIENT_COPY` and mirrors the server catalog's Toss voice —
 * the same single-source pattern as `SIGNER_COPY`.
 *
 * Security: the link password is request-only. It is passed straight to `/unlock`
 * and never stored, cached, logged, or echoed — the server hashes it at rest and
 * only ever returns `requiresPassword` (a boolean).
 */

import { apiFetch, apiUrl } from './api';
import { SHARE_PASSWORD_MIN_LENGTH } from './sharing';
import type { SignFieldType, SignerSender, SignRequestStatus } from './signing';

// --- response shapes (mirror SharingService return types) --------------------

/** Pre-auth metadata for the share landing screen (no PDF / fields). */
export interface ShareMeta {
  documentTitle: string;
  sender: SignerSender;
  /** Whether `/unlock` requires the link password (the value is never returned). */
  requiresPassword: boolean;
  /** ISO expiry instant, or null for "만료 없음". */
  expiresAt: string | null;
  /** True once the recipient has already submitted (a terminal state). */
  alreadySubmitted: boolean;
}

export interface ShareUnlockResult {
  sessionToken: string;
}

/** A recipient's assigned field with normalized (0..1) geometry. */
export interface SharePayloadField {
  id: string;
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  filled: boolean;
}

export interface SharePayload {
  documentTitle: string;
  pageCount: number;
  pdfPath: string;
  fields: SharePayloadField[];
}

export interface ShareSubmitResult {
  status: SignRequestStatus;
  /** True when this submission completed the document as a whole. */
  documentCompleted: boolean;
  message: string;
}

// --- session token persistence (tab-scoped, `esign.share.` namespace) --------

const SESSION_PREFIX = 'esign.share.';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function sessionKey(accessToken: string): string {
  return `${SESSION_PREFIX}${accessToken}`;
}

/** Persist the share session token for this link (tab-scoped, best-effort). */
export function setShareSession(accessToken: string, sessionToken: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(sessionKey(accessToken), sessionToken);
  } catch {
    // Storage may be unavailable (private mode / quota); the token also lives in
    // memory for the active flow, so persistence is a convenience only.
  }
}

export function getShareSession(accessToken: string): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(sessionKey(accessToken));
  } catch {
    return null;
  }
}

export function clearShareSession(accessToken: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(sessionKey(accessToken));
  } catch {
    // Nothing to recover from — see setShareSession.
  }
}

// --- endpoints ---------------------------------------------------------------

const base = (accessToken: string) => `/share/${encodeURIComponent(accessToken)}`;

/** ① Pre-auth metadata for the landing/gate screen. */
export function fetchShareMeta(accessToken: string): Promise<ShareMeta> {
  return apiFetch<ShareMeta>(base(accessToken));
}

/**
 * ② Open the link → receive a short-lived share session token. Pass the password
 * only when the link requires one; an open link unlocks immediately.
 */
export function unlockShare(
  accessToken: string,
  password?: string,
): Promise<ShareUnlockResult> {
  return apiFetch<ShareUnlockResult>(`${base(accessToken)}/unlock`, {
    method: 'POST',
    json: password ? { password } : {},
  });
}

/** ③ The recipient's fields + PDF path (session required). */
export function fetchSharePayload(
  accessToken: string,
  sessionToken: string,
): Promise<SharePayload> {
  return apiFetch<SharePayload>(`${base(accessToken)}/payload`, { token: sessionToken });
}

/** ④ Absolute URL of the session-guarded PDF byte stream (opened by the viewer). */
export function sharePdfUrl(accessToken: string): string {
  return apiUrl(`${base(accessToken)}/pdf`);
}

/** ⑤ Persist captured field values (session required). */
export function saveShareFields(
  accessToken: string,
  sessionToken: string,
  fields: { fieldId: string; value: string }[],
): Promise<{ saved: number }> {
  return apiFetch<{ saved: number }>(`${base(accessToken)}/fields`, {
    method: 'POST',
    token: sessionToken,
    json: { fields },
  });
}

/** ⑥ Finalize the recipient's submission (session required). */
export function submitShare(
  accessToken: string,
  sessionToken: string,
): Promise<ShareSubmitResult> {
  return apiFetch<ShareSubmitResult>(`${base(accessToken)}/submit`, {
    method: 'POST',
    token: sessionToken,
  });
}

// --- client-authored copy (design-spec messaging/share-link.md) --------------

/**
 * The recipient-facing strings authored on the client (the server returns only
 * access/error copy, not screen chrome). Single source so the Toss voice stays
 * consistent and auditable — the receiver counterpart to `SIGNER_COPY`.
 */
export const SHARE_RECIPIENT_COPY = {
  /** Password gate (`verify-screen/password-gate`). */
  gate: {
    title: '비밀번호를 입력해 주세요',
    hint: '이 계약서는 비밀번호로 보호되어 있어요.',
    label: '비밀번호',
    placeholder: '비밀번호를 입력해 주세요',
    submit: '확인',
    submitting: '확인 중',
    /** Client-side guard mirroring the server min length, before the server replies. */
    tooShort: `비밀번호는 ${SHARE_PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.`,
    /** Fallback when the failure carries no server message. */
    fallbackError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  },
  /** Terminal notice screens (`notice-screen`, expired/disabled/…). */
  notice: {
    expired: {
      title: '링크가 만료됐어요',
      body: '이 링크는 유효 기간이 지났어요. 보낸 분에게 새 링크를 요청해 주세요.',
    },
    disabled: {
      title: '지금은 열 수 없는 링크예요',
      body: '보낸 분이 이 링크를 사용 중지했어요. 보낸 분에게 문의해 주세요.',
    },
    invalidLink: {
      title: '링크를 확인해 주세요',
      body: '링크가 올바르지 않아요. 보낸 분에게 링크를 다시 요청해 주세요.',
    },
    notSignable: {
      title: '지금은 작성할 수 없어요',
      body: '지금은 작성할 수 없는 계약이에요. 보낸 분에게 문의해 주세요.',
    },
    alreadySubmitted: {
      title: '이미 제출했어요',
      body: '이미 제출을 완료한 계약이에요.',
    },
  },
  /** Document viewer chrome (recipient speaks "작성/제출"). */
  viewer: {
    ctaContinue: '작성하기',
    ctaComplete: '제출하기',
    loadError: '문서를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.',
    progressNone: '작성할 항목이 없어요.',
    progressAllDone: '모든 항목을 작성했어요.',
    completeError: '제출하지 못했어요. 잠시 후 다시 시도해 주세요.',
  },
  /** Submit-success completion takeover (`completion-screen`, Download 비노출). */
  done: {
    title: '제출이 완료되었습니다!',
    body: '작성하신 내용이 안전하게 전달됐어요.',
    documentLabel: '제출한 문서',
    next: '보낸 분이 확인할 수 있도록 전달했어요. 이제 창을 닫으셔도 돼요.',
  },
} as const;
