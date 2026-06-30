/**
 * Admin branding-settings client + single source of truth.
 *
 * Wraps the authenticated `/branding` endpoints (see
 * `apps/api/src/branding/branding.controller.ts`) and owns everything the
 * "회사 설정 → 브랜딩" screen needs in one place:
 *   - the font catalog (the predefined, safe `BrandFont` set),
 *   - the hex-color input rules (byte-for-byte the server's `HEX_COLOR`),
 *   - the client-authored chrome copy (`BRANDING_COPY`), which inherits the
 *     server's Toss voice (`messaging/branding`),
 *   - and the API calls themselves.
 *
 * Server error copy is surfaced verbatim through `ApiError`; only screen chrome
 * is authored here, mirroring how `lib/signing.ts` keeps `SIGNER_COPY`.
 */

import { ApiError, GENERIC_ERROR, apiFetch } from './api';
import { getToken } from './auth';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const API_BASE = `${API_ORIGIN}/api`;

// --- types (mirror the server's BrandingView / BrandFont enum) ---------------

/** Predefined signer-screen font set — 1:1 with the server `BrandFont` enum. */
export type BrandFont = 'SANS' | 'SERIF' | 'SCRIPT';

export interface BrandingView {
  brandColor: string | null;
  brandFont: BrandFont | null;
  logoUrl: string | null;
  /** Plan eligibility — the editor is gated on this flag. */
  brandingEnabled: boolean;
}

// --- font catalog (single source for the dropdown + the preview) -------------

export interface FontOption {
  value: BrandFont;
  /** User-facing label (no internal enum exposed). */
  label: string;
  /** Short note shown under the label in the dropdown. */
  note: string;
  /** Tailwind family utility — maps to the typography `family-*` tokens. */
  className: string;
}

/**
 * The fonts a sender may pick. Each maps to a typography `family-*` token
 * (`font-sans`/`font-serif`/`font-script` in the Tailwind theme); this list is
 * the only place that ordering/labelling lives.
 */
export const FONT_CATALOG = [
  { value: 'SANS', label: '기본 고딕', note: '깔끔한 산세리프 · 가독성 좋아요', className: 'font-sans' },
  { value: 'SERIF', label: '명조', note: '단정한 세리프 · 신뢰감 있어요', className: 'font-serif' },
  { value: 'SCRIPT', label: '손글씨', note: '부드러운 손글씨 · 친근해요', className: 'font-script' },
] as const;

/** The font applied when a sender hasn't chosen one (= the default tokens). */
export const DEFAULT_FONT: BrandFont = 'SANS';

/** Tailwind family utility for a font (falls back to the default family). */
export function fontClassName(font: BrandFont | null | undefined): string {
  return FONT_CATALOG.find((f) => f.value === font)?.className ?? 'font-sans';
}

/** The catalog entry for a font (falls back to the default option). */
export function fontOption(font: BrandFont | null | undefined): FontOption {
  return FONT_CATALOG.find((f) => f.value === font) ?? FONT_CATALOG[0];
}

// --- color rules (identical to the server DTO / lib/branding.ts) -------------

/** Accepts `#rgb` / `#rrggbb` only — same rule the server persists against. */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

/**
 * Expand a valid `#rgb`/`#rrggbb` color to a lowercase `#rrggbb` — the form the
 * native color picker requires. Returns null when the input isn't a valid hex.
 */
export function expandHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!HEX_COLOR.test(v)) return null;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return v;
}

/**
 * Tidy a typed hex toward the canonical form as the user edits: keep only hex
 * digits, cap at 6, and ensure a single leading `#`. Lets someone paste
 * `4F46E5` and still land on `#4f46e5` without fighting the field.
 */
export function normalizeHexInput(raw: string): string {
  const digits = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toLowerCase();
  return `#${digits}`;
}

// --- logo upload rules (mirror the server gate: JPG/PNG/SVG, ≤2MB) -----------

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB — matches MAX_LOGO_BYTES server-side.
/** `accept` attribute for the file picker. */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg';

const LOGO_EXT = ['png', 'jpg', 'jpeg', 'svg'];
const LOGO_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/svg'];

/**
 * Client-side logo guard — mirrors the server's format/size copy so the user
 * gets the same wording instantly, before any round-trip. Returns a Korean
 * guard message, or null when the file is acceptable.
 */
export function validateLogo(file: File): string | null {
  if (file.size === 0) return BRANDING_COPY.logo.guardEmpty;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : '';
  const mime = (file.type || '').toLowerCase();
  const okExt = LOGO_EXT.includes(ext);
  const okMime = mime === '' || LOGO_MIME.includes(mime);
  if (!okExt || !okMime) return BRANDING_COPY.logo.guardFormat;
  if (file.size > MAX_LOGO_BYTES) return BRANDING_COPY.logo.guardTooLarge;
  return null;
}

// --- API ---------------------------------------------------------------------

/** Current color/font/logo + plan eligibility for the signed-in sender. */
export function getBranding(): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding', { token: getToken() ?? undefined });
}

/**
 * Save brand color/font. `null` clears a field back to the default tokens.
 * Throws `ApiError` (403 upgrade-required, 400 invalid color/font).
 */
export function updateBranding(input: {
  brandColor?: string | null;
  brandFont?: BrandFont | null;
}): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding', {
    method: 'PUT',
    token: getToken() ?? undefined,
    json: input,
  });
}

/** Remove the brand logo (signer falls back to the monogram). */
export function deleteLogo(): Promise<BrandingView> {
  return apiFetch<BrandingView>('/branding/logo', {
    method: 'DELETE',
    token: getToken() ?? undefined,
  });
}

export interface UploadProgress {
  loaded: number;
  total: number;
  /** Whole-percent 0–100 (0 while the total is still unknown). */
  pct: number;
}

export interface UploadLogoOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

function extractMessage(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as { message?: unknown };
    const message = body?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  return null;
}

/**
 * Upload (or replace) the brand logo with a live progress bar. `fetch` can't
 * report upload progress, so this uses `XMLHttpRequest` while mirroring
 * `apiFetch`'s contract (same `/api` base, bearer token, verbatim server copy).
 * Endpoint: `POST /api/branding/logo` (field name `file`) → `BrandingView`.
 */
export function uploadLogo(file: File, options: UploadLogoOptions = {}): Promise<BrandingView> {
  const { onProgress, signal } = options;
  const token = getToken() ?? undefined;

  return new Promise<BrandingView>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/branding/logo`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      const pct = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
      onProgress({ loaded: event.loaded, total, pct });
    };

    xhr.onload = () => {
      cleanup();
      const message = extractMessage(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as BrandingView);
        } catch {
          reject(new ApiError(GENERIC_ERROR, xhr.status));
        }
        return;
      }
      reject(new ApiError(message ?? GENERIC_ERROR, xhr.status));
    };

    xhr.onerror = () => {
      cleanup();
      reject(new ApiError(GENERIC_ERROR, 0));
    };

    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

// --- client-authored chrome copy (mirrors messages.branding.* voice) ---------

/**
 * Every admin-facing string on the branding screen lives here — the single
 * source so the voice stays consistent and auditable. Same Toss tone as the
 * server catalog (`apps/api/src/common/messages.ts` → `messaging/branding`):
 * 탓하지 않고 다음 행동을 안내, 해요체, 내부 사정(플랜 enum/검증 규칙) 비노출.
 */
export const BRANDING_COPY = {
  // Page chrome.
  breadcrumbRoot: '회사 설정',
  title: '브랜딩',
  subtitle: '서명자에게 보여지는 화면에 회사의 로고·색상·글꼴을 적용해요.',
  backToDashboard: '대시보드로',

  // Plan gate (FREE → locked/upsell).
  lock: {
    badge: 'Team 플랜',
    title: '브랜딩은 Team 플랜부터 사용할 수 있어요',
    body: '로고·브랜드 색상·글꼴로 서명 화면을 우리 회사답게 꾸며 보세요. Team 플랜으로 업그레이드하면 바로 설정할 수 있어요.',
    cta: '플랜 업그레이드',
  },

  // Logo uploader.
  logo: {
    label: '로고',
    note: '권장 크기는 512×512px 내외의 정사각형 이미지예요. 최대 2MB까지 올릴 수 있어요.',
    dropTitle: '로고를 끌어다 놓으세요',
    dropActive: '여기에 놓으면 올라가요',
    dropHint: '또는 클릭해서 파일을 선택하세요 (JPG · PNG · SVG)',
    pick: '파일 선택',
    uploading: '올리는 중',
    preparing: '이미지를 준비하고 있어요',
    replace: '교체',
    remove: '삭제',
    thumbAlt: '브랜드 로고 미리보기',
    // Client guards — same wording as the server's logo copy.
    guardEmpty: '이미지 파일이 비어 있어요. 다른 파일로 다시 시도해 주세요.',
    guardFormat: 'JPG, PNG, SVG 형식의 이미지만 올릴 수 있어요.',
    guardTooLarge: '로고 이미지가 너무 커요. 2MB 이하의 이미지로 올려 주세요.',
    uploadedToast: '로고를 저장했어요.',
    removedToast: '로고를 삭제했어요.',
  },

  // Color field.
  color: {
    label: '브랜드 색상',
    hint: '버튼·링크 등 강조 요소에 쓰여요. 예: #4F46E5',
    placeholder: '#4F46E5',
    pickerLabel: '색상 선택',
    inputLabel: '색상 코드',
    invalid: '올바른 색상 코드를 입력해 주세요. 예: #4F46E5',
    reset: '기본값으로',
  },

  // Font select.
  font: {
    label: '글꼴',
    hint: '서명 화면의 텍스트에 적용돼요.',
    placeholder: '글꼴을 선택하세요',
  },

  // Live preview — renders the *real* signer chrome (BrandingHeader + the shared
  // Button) inside a device frame, toggled across the three signing-journey
  // states. The copy below is the single source for each state; it mirrors the
  // real screens' Toss voice (verify-screen / document-viewer / completion-screen)
  // so the preview reads exactly like what the signer gets.
  preview: {
    label: '미리보기',
    note: '서명자에게 이렇게 보여요.',
    // The mock sender shown in the frame; BrandingHeader appends its own
    // "님이 보낸 계약" caption, so it isn't duplicated here.
    senderName: '우리 회사',
    docTitle: '서비스 이용 계약서',
    // Accessible label for the stage toggle (a WAI-ARIA tablist).
    stageGroupLabel: '미리보기 화면',
    // Per-state chrome for the three device-frame stages, in journey order.
    stages: {
      verify: {
        tab: '본인확인',
        title: '본인확인',
        hint: '문자로 받은 6자리 인증 코드를 입력해 주세요.',
        cta: '본인확인',
      },
      sign: {
        tab: '문서 서명',
        progress: '서명할 항목 2곳 중 0곳을 작성했어요.',
        affordance: '여기에 서명',
        cta: '서명하기',
      },
      done: {
        tab: '완료',
        title: '서명이 완료되었습니다!',
        body: '작성하신 서명이 안전하게 전달됐어요.',
      },
    },
  },

  // Save action.
  save: '저장',
  saving: '저장 중',
  saved: '저장됐어요',
  savedToast: '브랜딩 설정을 저장했어요.',
  saveErrorToast: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',

  // Load failure.
  loadError: '브랜딩 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  retry: '다시 시도',
} as const;
