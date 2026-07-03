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

import type { ClauseExtractionStatus } from '@repo/db';
import { ApiError, apiDownload, apiFetch, apiUrl } from './api';
import {
  COMPLETION_DOWNLOAD_COPY,
  saveBlob,
  type CompletionArtifact,
} from './completion-download';

export type { ClauseExtractionStatus };

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
  fields: SigningPayloadField[];
}

/**
 * One AI-extracted key clause, rendered as a swipeable card (M2). Mirrors the
 * server's `ClauseCard` DTO (`SigningService`). The card is an *auxiliary*
 * reminder — legal effect stays with the source document, which the signer can
 * open at any time via the full-PDF view (`sourcePage` grounds each card there).
 * `caution` flags a clause worth a second look; `cautionReason` is a fixed label
 * (or `null` when `caution` is false).
 */
export interface ClauseCard {
  title: string;
  summary: string;
  sourcePage: number;
  caution: boolean;
  cautionReason: string | null;
}

/**
 * Clause-cards response contract (mirrors `SigningService.clauses`). `status`
 * echoes the document's cached extraction state; only `READY` carries a
 * non-empty `clauses` array. Every other status (`EMPTY`/`FAILED`/`PENDING`)
 * returns an empty array as the signal to fall back to the full-PDF view.
 */
export interface ClauseCardsResult {
  status: ClauseExtractionStatus;
  clauses: ClauseCard[];
}

// --- client-authored copy (mirrors messages.signing.* voice) -----------------

/**
 * The handful of signer-facing strings (and a greeting builder) authored on the
 * client — the server only returns error copy, not screen chrome. Kept here as
 * the single source so the tone stays consistent and auditable — same Toss voice
 * as the server catalog (`common/messages.ts`).
 */
export const SIGNER_COPY = {
  // --- Identity-check (OTP) screen ------------------------------------------
  // A light, friendly entry: warm welcome → one clear instruction → auto-submit
  // affordance → calm "checking" / "done" beats. Error tone mirrors the server
  // catalog (no blame, just the next step). Auto-submit is the primary path; the
  // button is an explicit/accessible fallback.
  verifyTitle: '본인확인',
  /**
   * Warm welcome above the code entry, using the pre-auth masked recipient name
   * (`meta.recipientNameMasked`, e.g. `홍*동`). Use `verifyGreetingFallback`
   * when the name is `null`.
   */
  verifyGreeting: (recipientNameMasked: string): string =>
    `${recipientNameMasked} 님, 안녕하세요.`,
  /** Name-less welcome when `recipientNameMasked` is `null`. */
  verifyGreetingFallback: '안녕하세요.',
  verifyHint: '문자로 받은 6자리 인증 코드를 입력해 주세요.',
  /** Auto-submit affordance — entering all six digits verifies without a tap. */
  verifyAutoSubmitHint: '6자리를 모두 입력하면 자동으로 확인돼요.',
  codeLabel: '인증 코드',
  /** Explicit/accessible fallback CTA label (auto-submit is the primary path). */
  verifyCta: '본인확인',
  /** Transient microcopy while the entered code is being checked. */
  verifySubmitting: '확인 중이에요',
  /** Brief success beat shown as the screen advances into the document. */
  verifySuccess: '확인됐어요',
  /**
   * Client-side fallback when verification fails without a server message
   * (network / unexpected error). Mirrors the server catalog's no-blame,
   * just-retry tone — the server's own code-mismatch/lock copy is surfaced
   * verbatim when present.
   */
  verifyError: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  loading: '잠시만 기다려 주세요.',
  // Friendly terminal screens for non-signable links (mirror the server catalog).
  alreadySignedTitle: '서명을 완료했어요',
  alreadySigned: '이미 서명을 완료한 계약이에요.',
  unavailableTitle: '서명할 수 없는 계약이에요',
  unavailable: '더 이상 서명할 수 없는 계약이에요. 발신자에게 문의해 주세요.',
  invalidLinkTitle: '링크를 확인해 주세요',
  invalidLink: '서명 링크가 올바르지 않아요. 발신자에게 링크를 다시 요청해 주세요.',
  /**
   * Key-clause cards screen chrome (M2) — the swipeable card stack the signer
   * sees after identity check, before the signature step. Same Toss voice as the
   * rest. The cards are an *auxiliary reminder*: legal effect stays with the
   * source document, reachable any time via `clause.viewFull`.
   */
  clause: {
    /** Compact screen heading above the card stack (parallels `verifyTitle`). */
    title: '핵심 조항 확인',
    /** Warm one-line intro framing the screen as a pre-sign reminder. */
    intro: '서명하기 전에 핵심 조항을 짚어 드릴게요.',
    /**
     * Advisory disclaimer pinning the AI summary's status — a reference aid; the
     * accurate content and legal effect live in the source document. The
     * `/clauses` response does NOT round-trip this line (it carries only status +
     * cards), so it's authored here and **mirrors the server catalog's
     * `MESSAGES.clause.advisoryNotice` verbatim** — the two must stay lockstep so
     * the disclaimer never diverges (messaging.md M1 mirror principle; same
     * same-value posture as `verifyError`). If the server value ever changes,
     * change this one too.
     */
    advisoryNotice:
      'AI가 핵심만 간추린 요약이에요. 참고용이며, 정확한 내용과 법적 효력은 계약 원문에 있어요.',
    /**
     * '주의' badge shown on a `caution === true` card. Label only — the reason
     * text is the server-owned `cautionReason` (a fixed `MESSAGES.clause.caution`
     * label), surfaced verbatim, so no client-side taxonomy is defined here.
     */
    cautionBadge: '주의',
    /** Source reference grounding a card in the full document, e.g. "원문 3쪽". */
    sourceRef: (page: number): string => `원문 ${page}쪽`,
    /**
     * The single bottom CTA into the signature step. Same label/role as the
     * viewer's `viewerCtaContinue`, kept as its own key for this screen (per the
     * `verifyCta` precedent — same value, distinct screen/role).
     */
    cta: '서명하기',
    /** Collapsed affordance opening the existing full-PDF viewer (no pressure). */
    viewFull: '전체 원문 보기',
    /** aria-label for the swipeable card region (screen-reader landmark). */
    cardsRegionLabel: '핵심 조항 카드',
    /** aria-label for the swipe/progress indicator, e.g. "3장 중 1장". */
    cardPosition: (current: number, total: number): string =>
      `${total}장 중 ${current}장`,
  },
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
  /**
   * Guided sequential signing-flow chrome (M3, `signing` phase) — the copy for
   * running the reused `SignatureInputSheet` through the unfilled fields one at a
   * time (see `conventions/signing-flow.md`, SF3–SF8). Same Toss voice (M2). This
   * group holds ONLY the new orchestration-layer strings; the per-field capture
   * labels (`sheet.*`, type titles/hints) and the viewer CTAs
   * (`viewerCtaContinue`/`viewerCtaComplete`) are REUSED as-is, not duplicated.
   */
  signFlow: {
    /**
     * Warm intro shown as the guided flow opens (parallels `clause.intro`) —
     * frames the step as "we'll walk you through it in order".
     */
    intro: '이제 서명할 곳을 순서대로 안내해 드릴게요.',
    /**
     * One-line hint that applying advances to the next field automatically, so
     * the '적용 → 뷰어 복귀 → 다시 탭' round-trip is gone (SF3).
     */
    hint: '한 곳을 마치면 다음 서명할 곳으로 바로 넘어가요.',
    /**
     * Sequential position within the guided queue, e.g. "3곳 중 1곳째" (SF4).
     * `total` (denominator) is the unfilled count snapshotted at entry — fixed so
     * skipping (SF5) never makes it jitter; `current` is the 1-based position of
     * the field the sheet is on. Distinct from the viewer's *cumulative* progress
     * line ("서명할 항목 N곳 중 M곳을 작성했어요"), which stays unchanged — one is a
     * position, the other a completed tally (SF4). Function-value copy per the
     * `clause.cardPosition` / `verifyGreeting` precedent.
     */
    progress: (current: number, total: number): string =>
      `${total}곳 중 ${current}곳째`,
    /**
     * `aria-live="polite"` line announced as the sheet auto-advances to the next
     * field (SF4) — position + which kind of field is now due, so screen-reader
     * users hear "what am I doing now". Uses `fieldNoun` for the type; phrased
     * with '차례' to sidestep 을/를 particle agreement across types.
     */
    announce: (current: number, total: number, fieldNoun: string): string =>
      `${total}곳 중 ${current}곳째, ${fieldNoun} 차례예요.`,
    /** Short field-type nouns for the `announce` aria-live line (SF4). */
    fieldNoun: {
      SIGNATURE: '서명',
      DATE: '날짜',
      TEXT: '내용',
    },
    /**
     * Save-less step back to the previous field for review/edit (SF5). Hidden/
     * disabled on the first field. Distinct from '적용' (save + advance).
     */
    prev: '이전',
    /**
     * Save-less step forward to review an already-filled field (SF5, the '이전'
     * counterpart). "Move without saving", as opposed to '적용'.
     */
    next: '다음',
    /**
     * Leave the current field unfilled for now and move on (SF5). The field stays
     * in the queue and must be filled before completion — the progress line and
     * `announce` keep signalling that something remains.
     */
    skip: '나중에',
    /**
     * Primary-action label on the LAST field: applying here saves and chains
     * `complete()` (SF6), so the button reads as finishing rather than '적용'.
     * Same value/role as the viewer's `viewerCtaComplete` — kept as its own key
     * for this surface (the `verifyCta` precedent: same value, distinct role).
     */
    applyLast: '서명 완료',
    /**
     * Retry affordance when a field save fails and the flow blocks auto-advance
     * (SF7). The error message itself REUSES `sheet.saveError` (`role="alert"`);
     * this is just the action label to try the save again — distinct from
     * `sheet.reset` ('다시', which clears the canvas).
     */
    retry: '다시 시도',
  },
  /** Completion takeover chrome (same Toss voice as the rest). */
  done: {
    /** Celebration headline — mirrors the server's `completed` catalog entry. */
    title: '서명이 완료되었습니다!',
    body: '작성하신 서명이 안전하게 전달됐어요.',
    /**
     * aria-label for the just-signed contract summary card region (sr landmark),
     * so the card reads as one grouped "what you just signed" summary.
     */
    summaryLabel: '서명한 계약 요약',
    /** Calm post-summary: which document was signed. */
    documentLabel: '서명한 문서',
    /** Field label for the signed-at timestamp (grain-1 `signedAt`, KST). */
    signedAtLabel: '서명 일시',
    /** Section label above the key-clause recap inside the summary card. */
    clausesLabel: '핵심 조항',
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
 * ③b The AI-extracted key-clause cards for this signing (session required).
 * Read straight from the send-time cache — never generated on link-open. The
 * server always resolves with a `ClauseCardsResult`: only `READY` carries cards,
 * every other status returns an empty array as the fallback signal. Callers
 * treat a rejection (network / non-ready / timeout) the same as an empty result
 * — the clause cards are a reminder aid, never a gate on reaching the document.
 */
export function fetchClauses(
  accessToken: string,
  sessionToken: string,
): Promise<ClauseCardsResult> {
  return apiFetch<ClauseCardsResult>(`${base(accessToken)}/clauses`, {
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
  /**
   * ISO-8601 timestamp of when this signer's part was finalized (server clock).
   * The completion screen formats it as the signed-at line via `formatKstDateTime`
   * and hands it to `CompletionDownload` as `completedAt` so its notice renders.
   */
  signedAt: string;
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
