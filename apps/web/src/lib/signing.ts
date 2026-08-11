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

import { ApiError, apiDownload, apiFetch, apiUrl } from './api';
import {
  COMPLETION_DOWNLOAD_COPY,
  saveBlob,
  type CompletionArtifact,
} from './completion-download';
import type {
  FillCompletionSummary,
  FillFieldValue,
} from '@/components/signer/fill-context';

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
  /**
   * The field's stored value on a resumed session — a SIGNATURE PNG data URL, an
   * ISO `YYYY-MM-DD` date, or the original TEXT — mirroring the server's projected
   * value (`SigningService.payload`). `null` when the field is unfilled. The
   * client deserializes it via {@link deserializeFieldValue} to render the real
   * value inline (not the "작성됨" placeholder) after a re-verify (spec §5 / M-6).
   */
  value: string | null;
}

// --- 핵심 조항 카드 (mirror the server's ExtractedClause contract) -----------

/**
 * The kind of key figure surfaced on a card — mirrors the server's
 * `ClauseFigureKind` (`apps/api/src/pdf/clause-extraction.types.ts`).
 */
export type ClauseFigureKind = 'money' | 'period' | 'date';

/** A single highlighted figure (금액·기간·날짜) pulled from a clause body. */
export interface ClauseFigure {
  kind: ClauseFigureKind;
  /** The raw matched substring, verbatim from the source text. */
  value: string;
}

/**
 * One structured clause card as projected onto the signer payload. Mirrors the
 * server's `ExtractedClause` so the card screen binds to it directly.
 */
export interface ExtractedClause {
  /** Human-readable clause title (e.g. "제3조 (계약기간)"). */
  title: string;
  /** Plain-language ("일상어") rendering of the clause body. */
  plainText: string;
  /** Key figures to emphasize on the card, in reading order, de-duplicated. */
  figures: ClauseFigure[];
  /** `true` when the clause carries risk language → render in a warning tone. */
  caution: boolean;
  /** 1-based page the clause starts on — the "원문 보기" deep-link anchor. */
  page: number;
}

export interface SigningPayload {
  documentTitle: string;
  pageCount: number;
  pdfPath: string;
  fields: SigningPayloadField[];
  /**
   * Top 1–5 핵심 조항 cards, or `[]` when the server extracted none / failed.
   * An empty array routes the signer straight to the document viewer (no error
   * screen) — see {@link entryPhaseAfterVerify}.
   */
  clauses: ExtractedClause[];
}

/** Hard cap on rendered cards — mirrors the server's 1–5 selection contract. */
export const MAX_CLAUSE_CARDS = 5;

/**
 * Decide the entry screen once a verify resolves: the 핵심 조항 카드 화면 when at
 * least one clause was extracted, otherwise straight to the document viewer. The
 * 0-card case is a *silent* fallback (no error screen) per the spec. Pure so the
 * routing decision stays unit-testable.
 */
export function entryPhaseAfterVerify(
  payload: Pick<SigningPayload, 'clauses'>,
): 'cards' | 'viewing' {
  return visibleClauseCards(payload.clauses).length > 0 ? 'cards' : 'viewing';
}

/**
 * The clauses the card screen actually renders: the server already returns at
 * most {@link MAX_CLAUSE_CARDS}, but we clamp defensively so the client never
 * renders more than five even if a payload arrives over-full.
 */
export function visibleClauseCards(clauses: ExtractedClause[]): ExtractedClause[] {
  return clauses.slice(0, MAX_CLAUSE_CARDS);
}

// --- signing progress (pure math for the viewer's bottom progress bar) --------

/**
 * The viewer's bottom progress state, derived purely from field counts so the
 * visual progress bar and its count text stay unit-testable and free of any
 * flow-specific copy. `ratio` drives both the bar's fill width and its
 * `aria-valuenow` (as a 0–1 fraction); `label` is a locale-neutral fraction
 * ("2 / 4") the flow's copy wraps into a sentence; `complete` flips the CTA to
 * its finalize label.
 */
export interface SignProgress {
  /** Completion fraction in [0, 1] — bar fill width + aria value. */
  ratio: number;
  /** Locale-neutral count fraction, e.g. "2 / 4". */
  label: string;
  /** True once every field is done (also true when there is nothing to fill). */
  complete: boolean;
}

/**
 * Derive the viewer's progress state from the total assigned fields and how many
 * are done. Inputs are clamped defensively (non-negative integers, `done` never
 * exceeds `total`) so a transient over-count can't drive the bar past 100% or
 * produce a negative width. An empty field set (`total === 0`) reads as complete
 * with a full ratio — there is nothing left to fill. Pure so it stays testable.
 */
export function signProgress(total: number, done: number): SignProgress {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeDone = Math.min(Math.max(0, Math.trunc(done)), safeTotal);
  return {
    ratio: safeTotal === 0 ? 1 : safeDone / safeTotal,
    label: `${safeDone} / ${safeTotal}`,
    complete: safeDone >= safeTotal,
  };
}

// --- completion summary (spec §6: 요약 카드 실제 값 + 다운로드/준비중) ---------

/**
 * Format an ISO instant as the completion card's 서명 완료 시각 in Korean, pinned
 * to KST regardless of the viewer's device timezone (a signed timestamp is a
 * legal fact — it must read the same everywhere). Uses `Intl.DateTimeFormat`
 * ('ko-KR', Asia/Seoul) → e.g. "2026년 8월 11일 오후 2:30". Returns an empty
 * string for an absent/unparseable input so the row is simply omitted. Pure.
 */
export function formatSignedAt(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

/** The ordered summary-card fact rows the completion screen may render. */
export type CompletionSummaryRowKey = 'contractDate' | 'contractAmount' | 'signedAt';

/** One rendered summary row: a stable key (→ label lookup) + its display value. */
export interface CompletionSummaryRow {
  key: CompletionSummaryRowKey;
  /** The display string — raw figure for date/amount, formatted for signedAt. */
  value: string;
}

/**
 * Build the completion summary's fact rows in reading order (날짜 → 금액 →
 * 서명시각), omitting any whose value is absent/blank so the card shows only real
 * values (spec §6 "추출 가능한 경우" / 값 없는 행 생략). The signedAt is formatted
 * to ko-KR/KST via {@link formatSignedAt}; the raw date/amount figures pass
 * through verbatim (they are already human-readable Korean substrings). Pure so
 * the omission rules stay unit-testable independent of rendering.
 */
export function completionSummaryRows(
  summary: FillCompletionSummary,
): CompletionSummaryRow[] {
  const rows: CompletionSummaryRow[] = [];
  const date = summary.contractDate?.trim();
  if (date) rows.push({ key: 'contractDate', value: date });
  const amount = summary.contractAmount?.trim();
  if (amount) rows.push({ key: 'contractAmount', value: amount });
  const signedAt = formatSignedAt(summary.signedAt);
  if (signedAt) rows.push({ key: 'signedAt', value: signedAt });
  return rows;
}

/** Which artifact affordance the completion screen shows in its download area. */
export type CompletionArtifactState = 'download' | 'processing' | 'none';

/**
 * Decide the completion screen's download-area affordance (spec §6): the
 * "서명된 계약서 다운로드" button once the final PDF is ready, the "계약서 준비 중"
 * notice while the completed document's PDF is still being generated, or nothing
 * when there is no download to offer (a flow without an artifact, or a document
 * not yet complete — other signers still pending). Pure.
 */
export function completionArtifactState(input: {
  /** The flow offers a completed-artifact download (OTP only). */
  hasDownload: boolean;
  /** The final signed PDF is generated and downloadable. */
  documentReady: boolean;
  /** Every signer has finished — the document as a whole is complete. */
  documentCompleted: boolean;
}): CompletionArtifactState {
  if (!input.hasDownload) return 'none';
  if (input.documentReady) return 'download';
  if (input.documentCompleted) return 'processing';
  return 'none';
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
  // Session-expiry re-auth notice. `sessionExpired` mirrors the server's
  // `messages.signing.sessionExpired` verbatim (the voice stays one); shown when a
  // session-guarded call 401s so the signer can re-verify and return to the flow.
  sessionExpiredTitle: '다시 인증해 주세요',
  sessionExpired: '본인확인 후 시간이 지났어요. 인증 코드를 다시 입력해 주세요.',
  sessionReauth: '다시 인증하기',
  // 핵심 조항 카드 화면 chrome (shown right after verify when clauses exist).
  cards: {
    /** Screen headline — "read only the essentials first". */
    title: '먼저 핵심 내용만 확인해요',
    /** Calm subhead pointing at the full original below. */
    subtitle: '꼭 알아야 할 조항만 쉬운 말로 정리했어요. 원문은 언제든 열어볼 수 있어요.',
    /** Badge on a caution clause (warning tone). */
    cautionLabel: '주의',
    /** Per-card deep-link into the original at that clause's page. */
    cardDeepLink: '이 조항 원문 보기',
    /** Bottom CTA into the full original document. */
    viewFull: '원문 보기',
    /** Accessible label prefix for a key figure, by kind. */
    figureLabel: {
      money: '금액',
      period: '기간',
      date: '날짜',
    },
  },
  // Document viewer chrome (mirrors the same Toss voice).
  viewerCtaContinue: '다음 서명란으로 이동',
  viewerCtaComplete: '서명 완료하기',
  viewerLoadError: '문서를 불러올 수 없어요. 잠시 후 다시 시도해 주세요.',
  /** Back affordance that collapses the original and returns to the clause cards. */
  viewerCollapse: '접기',
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
   * Final confirm sheet chrome (spec §6 / S-6): a last calm checkpoint after every
   * field is captured, before the irreversible complete fires. "확인" finalizes,
   * "닫기" returns to the viewer with every captured value intact.
   */
  confirm: {
    title: '이대로 서명을 완료할까요?',
    body: '완료하면 서명이 최종 제출되고, 이후에는 수정할 수 없어요.',
    confirm: '확인',
    cancel: '닫기',
  },
  /** Completion takeover chrome (same Toss voice as the rest). */
  done: {
    /** Celebration headline — mirrors the server's `completed` catalog entry. */
    title: '서명이 완료되었습니다!',
    body: '작성하신 서명이 안전하게 전달됐어요.',
    /** Calm post-summary: which document was signed. */
    documentLabel: '서명한 문서',
    /** Summary-card fact row labels (계약 날짜·금액·서명 완료 시각). */
    contractDateLabel: '계약 날짜',
    contractAmountLabel: '계약 금액',
    signedAtLabel: '서명 완료 시각',
    /** Shown while the final signed PDF is still being generated (no download yet). */
    processing: '계약서 준비 중입니다. 최종 계약서가 준비되면 이메일로 안내드릴게요.',
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

/**
 * A session-guarded signer call failed because the session lapsed: the server
 * returns 401 with its `sessionExpired` copy once the ~30-minute token expires,
 * and the flow also synthesizes a 401 when no session is stored at all. The flow
 * catches this to clear the dead session and route the signer back to re-verify.
 * Pure so the decision stays unit-testable.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
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
  /** ISO-8601 서명 완료 시각 for the completion summary card (spec §6). */
  signedAt: string;
  /** 계약 날짜 derived from clause figures, or null when not extractable. */
  contractDate: string | null;
  /** 계약 금액 derived from clause figures, or null when not extractable. */
  contractAmount: string | null;
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

/**
 * Rehydrate a server-persisted field value string back into the client's
 * {@link FillFieldValue} — the inverse of {@link serializeFieldValue}. Used to
 * restore a resumed session so the viewer shows the real value inline instead of
 * the "작성됨" placeholder (spec §5 / M-6). Returns `null` for an absent or empty
 * value (nothing to restore — the field stays unfilled).
 *
 * The chosen signature font (`fontFamily`) is *not* recoverable — the server
 * stores only the value string — so a restored TEXT renders in the default face;
 * the value itself (the legally meaningful content) is preserved exactly.
 */
export function deserializeFieldValue(
  type: SignFieldType,
  value: string | null,
): FillFieldValue | null {
  if (value == null) return null;
  if (type === 'SIGNATURE') return value ? { type: 'SIGNATURE', dataUrl: value } : null;
  const text = value.trim();
  if (!text) return null;
  return type === 'DATE' ? { type: 'DATE', text } : { type: 'TEXT', text };
}
