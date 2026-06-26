/**
 * Share-link data access for the sender.
 *
 * Typed wrappers over the owner-scoped `/documents/:id/share-links` endpoints
 * (see `apps/api/src/sharing/sharing.controller.ts`). Response shapes mirror the
 * server's `ShareLinkView` so the detail screen binds to them directly.
 *
 * Copy lives here as a single source of truth (like `SIGNER_COPY` /
 * `CONTRACT_DETAIL_COPY`), authored from design-spec `messaging/share-link.md`
 * (Toss-tone 해요체). The validity presets are config + copy paired in one place.
 *
 * Security: a link password is request-only. It is passed straight to the create
 * call and never stored, cached, logged, or echoed back — the server hashes it
 * at rest and only ever returns `requiresPassword` (a boolean).
 */

import { apiFetch } from './api';
import { getToken } from './auth';

/** Derived, sender-facing lifecycle state of a share link (mirrors the server). */
export type ShareLinkState = 'active' | 'expired' | 'revoked' | 'completed';

/** A share link as the owner sees it. Never carries the password or its hash. */
export interface ShareLink {
  id: string;
  token: string;
  /** Absolute open/fill URL to hand to the recipient. */
  url: string;
  label: string | null;
  status: ShareLinkState;
  /** Whether opening the link requires a password (the value is never returned). */
  requiresPassword: boolean;
  /** ISO expiry instant, or null for "만료 없음". */
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Settings for a new link. Password is plaintext in-flight only — see module note. */
export interface CreateShareLinkInput {
  /** Validity window in days. Ignored when `noExpiry` is true. */
  expiresInDays?: number;
  /** True ⇒ the link never expires ("만료 없음"). */
  noExpiry?: boolean;
  /** Optional access password (request-only; omit for an open link). */
  password?: string;
}

/** Lower bound the server enforces on a link password; validated client-side too. */
export const SHARE_PASSWORD_MIN_LENGTH = 4;

function authPath(documentId: string, suffix = ''): string {
  return `/documents/${encodeURIComponent(documentId)}/share-links${suffix}`;
}

/** Create a unique open/fill link with the given access settings. */
export function createShareLink(
  documentId: string,
  input: CreateShareLinkInput,
): Promise<ShareLink> {
  return apiFetch<ShareLink>(authPath(documentId), {
    method: 'POST',
    json: input,
    token: getToken() ?? undefined,
  });
}

/** List this document's share links with their derived status (newest first). */
export function listShareLinks(documentId: string): Promise<ShareLink[]> {
  return apiFetch<ShareLink[]>(authPath(documentId), { token: getToken() ?? undefined });
}

/** Revoke a link so it can no longer be opened (idempotent). */
export function revokeShareLink(documentId: string, linkId: string): Promise<ShareLink> {
  return apiFetch<ShareLink>(authPath(documentId, `/${encodeURIComponent(linkId)}/revoke`), {
    method: 'POST',
    token: getToken() ?? undefined,
  });
}

// --- validity presets -------------------------------------------------------

/** A single-select validity option in the create modal. */
export interface ExpiryPreset {
  key: string;
  label: string;
  /** Window in days, or null for "만료 없음". */
  days: number | null;
}

/** Order + default ("1주일") per design-spec `components/share-link-dialog`. */
export const EXPIRY_PRESETS = [
  { key: '1d', label: '1일', days: 1 },
  { key: '3d', label: '3일', days: 3 },
  { key: '1w', label: '1주일', days: 7 },
  { key: '1m', label: '1개월', days: 30 },
  { key: 'none', label: '만료 없음', days: null },
] as const satisfies readonly ExpiryPreset[];

export const DEFAULT_EXPIRY_PRESET_KEY = '1w';

/** Look up a preset by key, falling back to the default ("1주일"). */
export function findExpiryPreset(key: string): ExpiryPreset {
  return (
    EXPIRY_PRESETS.find((p) => p.key === key) ??
    EXPIRY_PRESETS.find((p) => p.key === DEFAULT_EXPIRY_PRESET_KEY) ??
    EXPIRY_PRESETS[0]
  );
}

/** Map a chosen preset to the create-call's expiry fields. */
export function expiryInput(preset: ExpiryPreset): Pick<CreateShareLinkInput, 'expiresInDays' | 'noExpiry'> {
  return preset.days == null ? { noExpiry: true } : { expiresInDays: preset.days };
}

/** Format an ISO expiry instant as a Korean calendar date ("2026년 7월 3일"). */
export function formatExpiryDate(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(new Date(iso));
}

/** The "만료 안내" line for a created link (`messaging/share-link`). */
export function expiryNote(link: Pick<ShareLink, 'expiresAt'>): string {
  return link.expiresAt
    ? `${formatExpiryDate(link.expiresAt)}까지 열 수 있어요.`
    : '만료 없이 계속 열 수 있어요.';
}

// --- copy (design-spec messaging/share-link.md) -----------------------------

export const SHARE_COPY = {
  header: {
    title: '링크로 공유하기',
    description: '링크를 받은 사람이 계약서를 열람하고 작성할 수 있어요.',
  },
  expiry: {
    label: '유효 기간',
    help: '유효 기간이 지나면 링크가 자동으로 만료돼요.',
  },
  password: {
    toggle: '비밀번호로 보호하기',
    label: '비밀번호',
    placeholder: '비밀번호를 입력해 주세요',
    hint: '이 비밀번호를 입력해야 계약서를 열 수 있어요. 받는 분에게 따로 알려 주세요.',
    /** Client-side guard before the server rejects a too-short password. */
    tooShort: `비밀번호는 ${SHARE_PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.`,
  },
  generate: {
    idle: '링크 만들기',
    loading: '만드는 중',
  },
  result: {
    linkLabel: '공유 링크',
    copy: '복사',
    copied: '복사됨',
    /** Brief confirmation surfaced to assistive tech via role="status". */
    copyToast: '링크를 복사했어요',
  },
  errors: {
    create: '링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
    copy: '링크를 복사하지 못했어요. 링크를 직접 선택해 복사해 주세요.',
  },
  /** Sender-facing labels for a link's lifecycle state (list pills). */
  state: {
    active: '사용 중',
    expired: '만료됨',
    revoked: '중지됨',
    completed: '제출 완료',
  } satisfies Record<ShareLinkState, string>,
  list: {
    /** Title for the live link list once links exist. */
    heading: '만든 링크',
    revoke: '사용 중지',
    revoking: '중지하는 중',
    revokeAria: (label: string) => `${label} 링크 사용 중지`,
    passwordTag: '비밀번호',
    loadError: '링크 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
    revokeError: '링크를 중지하지 못했어요. 잠시 후 다시 시도해 주세요.',
  },
} as const;

/** Copy/clipboard helper that surfaces a friendly failure when blocked. */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('clipboard-unavailable');
  }
  await navigator.clipboard.writeText(text);
}
