/**
 * Signer-side API client for the public signing flow.
 *
 * Wraps the JWT-free `/signing/:token/...` endpoints (see
 * `apps/api/src/signing/signing.controller.ts`). Response shapes mirror the
 * server's DTOs so the signer UI binds to them directly. `:token` is the
 * SignRequest access token embedded in the signing link.
 *
 * The short-lived signer *session* token (issued on code verification) is the
 * bearer for the session-guarded calls. We persist it per access token in
 * `sessionStorage` so a reload inside the same tab can resume, while it never
 * outlives the tab — matching the 30-minute, single-use nature of the session.
 *
 * User-facing error copy is owned by the server (`common/messages.ts`) and
 * surfaced verbatim through `ApiError`. The few strings authored client-side
 * (screen headings, the masked-token flag screens) live in `SIGNER_COPY` below
 * and intentionally mirror the server's signing catalog so the voice stays one.
 */

import type { ClauseSummary } from '@repo/db';
import { ApiError, apiDownload, apiFetch, apiUrl } from './api';
import {
  COMPLETION_DOWNLOAD_COPY,
  saveBlob,
  type CompletionArtifact,
} from './completion-download';

// --- shared status unions (mirror the Prisma enums; web stays server-free) ---

export type SignRequestStatus = 'PENDING' | 'VIEWED' | 'SIGNED' | 'DECLINED';
export type SigningDocumentStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type SignFieldType = 'SIGNATURE' | 'DATE' | 'TEXT';

// --- response shapes (mirror SigningService return types) --------------------

export interface SignerSender {
  name: string | null;
  brandColor: string | null;
  brandLogoUrl: string | null;
}

/** Pre-verification metadata for the landing screen (no PDF / fields). */
export interface SigningMeta {
  documentTitle: string;
  pageCount: number;
  documentStatus: SigningDocumentStatus;
  sender: SignerSender;
  recipientNameMasked: string | null;
  status: SignRequestStatus;
  alreadySigned: boolean;
  signable: boolean;
}

export interface VerifyResult {
  sessionToken: string;
  status: SignRequestStatus;
}

/** A signer's assigned field with normalized (0..1) geometry. */
export interface SigningPayloadField {
  id: string;
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  filled: boolean;
}

export interface SigningPayload {
  documentTitle: string;
  pageCount: number;
  pdfPath: string;
  /** AI key-clause summary for the summary-first screen; `null` = no summary. */
  clauseSummary: ClauseSummary | null;
  fields: SigningPayloadField[];
}

// --- client-authored copy (mirrors messages.signing.* voice) -----------------

/**
 * The handful of signer-facing strings authored on the client (the server only
 * returns error copy, not screen chrome). Kept here as the single source so the
 * tone stays consistent and auditable — same Toss voice as the server catalog.
 */
export const SIGNER_COPY = {
  verifyTitle: '본인확인',
  verifyHint: '문자로 받은 6자리 인증 코드를 입력해 주세요.',
  codeLabel: '인증 코드',
  loading: '잠시만 기다려 주세요.',
  // Friendly terminal screens for non-signable links (mirror the server catalog).
  alreadySignedTitle: '서명을 완료했어요',
  alreadySigned: '이미 서명을 완료한 계약이에요.',
  unavailableTitle: '서명할 수 없는 계약이에요',
  unavailable: '더 이상 서명할 수 없는 계약이에요. 발신자에게 문의해 주세요.',
  invalidLinkTitle: '링크를 확인해 주세요',
  invalidLink: '서명 링크가 올바르지 않아요. 발신자에게 링크를 다시 요청해 주세요.',
  // Document viewer chrome (mirrors the same Toss voice).
  viewerCtaContinue: '서명하기',
  viewerCtaComplete: '서명 완료',
  viewerLoadError: '문서를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.',
  fieldFilled: '작성됨',
  /** "Tap here" affordance shown on an unfilled field, by type. */
  fieldAffordance: {
    SIGNATURE: '여기에 서명',
    DATE: '여기에 날짜',
    TEXT: '여기에 입력',
  },
  // Signature input BottomSheet chrome (same Toss voice as the rest).
  sheet: {
    /** Sheet title, by field type. */
    title: {
      SIGNATURE: '서명 입력',
      DATE: '날짜 입력',
      TEXT: '내용 입력',
    },
    /** Mode toggle labels for a signature field. */
    modeDraw: '그리기',
    modeType: '입력',
    drawHint: '아래 칸에 손가락이나 펜으로 서명해 주세요.',
    typeHint: '이름을 입력하고 마음에 드는 글씨체를 골라 주세요.',
    typePlaceholder: '이름',
    fontLabel: '글씨체',
    dateLabel: '날짜',
    textLabel: '내용',
    textPlaceholder: '내용을 입력해 주세요',
    reset: '다시',
    apply: '적용',
    saveError: '서명을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
  },
  /** Completion takeover chrome (same Toss voice as the rest). */
  done: {
    /** Celebration headline — mirrors the server's `completed` catalog entry. */
    title: '서명이 완료되었습니다!',
    body: '작성하신 서명이 안전하게 전달됐어요.',
    /** Calm post-summary: which document was signed. */
    documentLabel: '서명한 문서',
    /** Heading for the key-clause recap on the completion card (summary present). */
    summaryHeading: '핵심 요약',
    /** What happens next, by whether the whole document is now complete. */
    nextAllDone: '모든 서명이 끝났어요. 완료된 계약서를 메일로 보내 드릴게요.',
    nextWaiting: '다른 분들의 서명이 끝나면 완료된 계약서를 메일로 보내 드릴게요.',
  },
  /** Final-CTA failure fallback (no blame, just retry) — when the server gives none. */
  completeError: '서명을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const;

// --- session token persistence ----------------------------------------------

const SESSION_PREFIX = 'esign.signer.';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function sessionKey(accessToken: string): string {
  return `${SESSION_PREFIX}${accessToken}`;
}

/** Persist the signer session token for this link (tab-scoped). */
export function setSignerSession(accessToken: string, sessionToken: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(sessionKey(accessToken), sessionToken);
  } catch {
    // Storage may be unavailable (private mode / quota). The token also lives in
    // memory for the active flow, so persistence is a best-effort convenience.
  }
}

export function getSignerSession(accessToken: string): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(sessionKey(accessToken));
  } catch {
    return null;
  }
}

export function clearSignerSession(accessToken: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(sessionKey(accessToken));
  } catch {
    // Nothing to recover from — see setSignerSession.
  }
}

// --- endpoints ---------------------------------------------------------------

const base = (accessToken: string) => `/signing/${encodeURIComponent(accessToken)}`;

/** ① Pre-auth metadata for the landing screen. */
export function fetchMeta(accessToken: string): Promise<SigningMeta> {
  return apiFetch<SigningMeta>(base(accessToken));
}

/** ② Verify the 6-digit code → receive a short-lived session token. */
export function verifyCode(accessToken: string, code: string): Promise<VerifyResult> {
  return apiFetch<VerifyResult>(`${base(accessToken)}/verify`, {
    method: 'POST',
    json: { code },
  });
}

/** ③ The signer's fields + PDF path (session required). */
export function fetchPayload(
  accessToken: string,
  sessionToken: string,
): Promise<SigningPayload> {
  return apiFetch<SigningPayload>(`${base(accessToken)}/payload`, {
    token: sessionToken,
  });
}

/**
 * ④ Absolute URL of the session-guarded PDF byte stream. The viewer opens it
 * via `loadPdfFromUrl` with the session token as a bearer header (the bytes are
 * binary, so this bypasses the JSON `apiFetch` path).
 */
export function signerPdfUrl(accessToken: string): string {
  return apiUrl(`${base(accessToken)}/pdf`);
}

/** One captured value to persist: the field id + its serialized string value. */
export interface FieldValueInput {
  fieldId: string;
  /** Signature PNG data URL / ISO `YYYY-MM-DD` date / non-empty text. */
  value: string;
}

/**
 * ⑤ Persist captured field values (session required). The server validates each
 * value against its field type (signature dataURL / ISO date / text) and writes
 * only fields assigned to this signer. Returns how many were saved.
 */
export function saveFields(
  accessToken: string,
  sessionToken: string,
  fields: FieldValueInput[],
): Promise<{ saved: number }> {
  return apiFetch<{ saved: number }>(`${base(accessToken)}/fields`, {
    method: 'POST',
    token: sessionToken,
    json: { fields },
  });
}

/** Result of finalizing the signer's part (mirrors SigningService.complete). */
export interface CompleteResult {
  status: SignRequestStatus;
  /** True when this was the last outstanding signer — the whole doc is now done. */
  documentCompleted: boolean;
  message: string;
}

/**
 * ⑥ Finalize the signer's part (session required). The server requires every
 * assigned field filled, flips the SignRequest to SIGNED, and reports whether
 * the document as a whole is now complete. Rejects with the server's Toss-tone
 * message (e.g. an incomplete/expired/already-signed state) so the viewer can
 * surface a friendly retry without losing the captured signature.
 */
export function completeSigning(
  accessToken: string,
  sessionToken: string,
): Promise<CompleteResult> {
  return apiFetch<CompleteResult>(`${base(accessToken)}/complete`, {
    method: 'POST',
    token: sessionToken,
  });
}

/**
 * ⑦ Download a completed contract's artifact as the signer and hand it to the
 * browser's "save file". Requires the active signer session (issued on code
 * verification); a missing session rejects with a neutral retry message. Rejects
 * with the server's Toss-tone message when the artifacts aren't ready yet.
 */
export async function downloadSignerArtifact(
  accessToken: string,
  kind: CompletionArtifact,
  fallbackTitle: string,
): Promise<void> {
  const session = getSignerSession(accessToken);
  if (!session) throw new ApiError(SIGNER_COPY.completeError, 401);

  const { blob, filename } = await apiDownload(`${base(accessToken)}/download/${kind}`, {
    token: session,
  });
  saveBlob(blob, filename ?? `${fallbackTitle} (${COMPLETION_DOWNLOAD_COPY.items[kind].title}).pdf`);
}

/**
 * Serialize a captured signer value into the server's string contract:
 * signature → data URL, text/date → the raw string. Returns `null` for an
 * empty/unsupported value (nothing to persist).
 */
export function serializeFieldValue(value: {
  type: SignFieldType;
  dataUrl?: string;
  text?: string;
}): string | null {
  if (value.type === 'SIGNATURE') return value.dataUrl ?? null;
  const text = value.text?.trim();
  return text ? text : null;
}
