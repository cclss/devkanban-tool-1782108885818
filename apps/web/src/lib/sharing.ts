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

// --- password confirm / edit (owner dashboard) ------------------------------

/**
 * The owner's view of a link's stored password, in three semantic states
 * (mirrors the server's `ShareLinkPasswordView`):
 *   • no password set       → { hasPassword: false, recoverable: false, password: null }
 *   • confirmable plaintext → { hasPassword: true,  recoverable: true,  password: '…' }
 *   • legacy (pre-migration hash, not confirmable)
 *                           → { hasPassword: true,  recoverable: false, password: null }
 * The plaintext is returned only on this authenticated owner path — never on any
 * recipient/public path.
 */
export interface ShareLinkPasswordView {
  hasPassword: boolean;
  recoverable: boolean;
  password: string | null;
}

/** Reveal a link's current access password to its owner (dashboard 확인). */
export function getShareLinkPassword(
  documentId: string,
  linkId: string,
): Promise<ShareLinkPasswordView> {
  return apiFetch<ShareLinkPasswordView>(
    authPath(documentId, `/${encodeURIComponent(linkId)}/password`),
    { token: getToken() ?? undefined },
  );
}

/**
 * Replace or clear a link's access password (dashboard 수정). A non-empty value
 * sets/replaces it; `null` removes password protection. Takes effect at once —
 * the returned link view reflects the new `requiresPassword`. The value itself is
 * request-only: never stored client-side, cached, logged, or echoed back.
 */
export function updateShareLinkPassword(
  documentId: string,
  linkId: string,
  password: string | null,
): Promise<ShareLink> {
  return apiFetch<ShareLink>(authPath(documentId, `/${encodeURIComponent(linkId)}/password`), {
    method: 'PUT',
    json: { password },
    token: getToken() ?? undefined,
  });
}

/** The row trigger label: 확인 when a password is set, 설정 when the link is open. */
export function passwordTriggerLabel(requiresPassword: boolean): string {
  return requiresPassword
    ? SHARE_COPY.passwordAdmin.open
    : SHARE_COPY.passwordAdmin.openUnset;
}

/** The hint that explains a link's current password state in the editor panel. */
export function passwordStateHint(view: ShareLinkPasswordView): string {
  if (!view.hasPassword) return SHARE_COPY.passwordAdmin.hintNone;
  return view.recoverable
    ? SHARE_COPY.passwordAdmin.hintRecoverable
    : SHARE_COPY.passwordAdmin.hintLegacy;
}

/**
 * The value the editor field starts with for a given password state: the
 * confirmable plaintext when recoverable, otherwise empty (no password / legacy
 * hash we can't show).
 */
export function passwordEditorInitialValue(view: ShareLinkPasswordView): string {
  return view.hasPassword && view.recoverable ? (view.password ?? '') : '';
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
  /**
   * Copy for the create wizard's 링크 공유 terminal step (shares the same body as
   * the modal, but adds a step header + a "done" confirmation and a
   * dashboard hand-off, matching the review step's success tone).
   */
  wizard: {
    title: '링크로 공유할게요',
    intro: '유효 기간과 비밀번호를 정하면 공유 링크를 만들어 드려요.',
    done: '링크가 준비됐어요. 복사해서 받는 분에게 전달해 주세요.',
    toDashboard: '대시보드로 가기',
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
  /**
   * Copy for the dashboard's per-link 비밀번호 확인·수정 panel (grain-3). Owner-only
   * client surface, so it lives here beside the other sender-facing link copy.
   * Tone follows the project messaging convention (해요체 · 탓하지 않기 · 다음 행동
   * 안내 · 내부 사정 비노출).
   */
  passwordAdmin: {
    /** Row trigger — label depends on whether a password is already set. */
    open: '비밀번호 확인',
    openUnset: '비밀번호 설정',
    close: '닫기',
    /** Announced while the current password is being fetched. */
    loading: '불러오는 중',
    label: '비밀번호',
    placeholder: '비밀번호를 입력해 주세요',
    /** State-dependent hints (see `passwordStateHint`). */
    hintNone: '설정된 비밀번호가 없어요. 새 비밀번호를 입력하면 링크에 비밀번호를 걸 수 있어요.',
    hintRecoverable: '이 비밀번호를 입력해야 계약서를 열 수 있어요. 받는 분에게 따로 알려 주세요.',
    hintLegacy: '이전에 설정한 비밀번호는 확인할 수 없어요. 새 비밀번호를 설정하면 다시 확인할 수 있어요.',
    save: '저장',
    saving: '저장하는 중',
    remove: '비밀번호 해제',
    removing: '해제하는 중',
    /** Client-side guard mirroring the create field's min-length rule. */
    tooShort: `비밀번호는 ${SHARE_PASSWORD_MIN_LENGTH}자 이상으로 입력해 주세요.`,
    /** Feedback surfaced after a successful save/remove (role="status"). */
    savedSet: '비밀번호를 설정했어요.',
    savedChanged: '비밀번호를 변경했어요.',
    savedRemoved: '비밀번호 보호를 해제했어요.',
    /** Non-server-roundtrip failures (the panel prefers ApiError.message). */
    loadError: '비밀번호를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
    saveError: '비밀번호를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
    /** Accessible name for the row trigger, disambiguated by the link's label. */
    triggerAria: (label: string) => `${label} 링크 비밀번호 관리`,
  },
} as const;

/** Copy/clipboard helper that surfaces a friendly failure when blocked. */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('clipboard-unavailable');
  }
  await navigator.clipboard.writeText(text);
}
