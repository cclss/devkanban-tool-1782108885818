/**
 * Completion-download domain helpers shared by the sender dashboard and the
 * signer completion screen.
 *
 * Single source for the download-area copy (design-spec
 * `components/completion-download/base.md`, voice.md §4) and the small browser
 * "save this blob" plumbing, so both surfaces name the two artifacts identically
 * and behave the same. The actual byte fetch lives next to each caller's auth
 * (owner JWT in `documents.ts`, signer session token in `signing.ts`).
 */

/** The two downloadable completion outputs (mirrors the server's union). */
export type CompletionArtifact = 'signed' | 'certificate';

/**
 * Confirmed copy for the completion download area (Toss voice).
 * Item names mirror voice.md §4 attachment names so the inbox and the dashboard
 * agree. The section title / status label reuse the existing single sources.
 */
export const COMPLETION_DOWNLOAD_COPY = {
  /** Section title. */
  sectionTitle: '완료 문서',
  /** Completion notice — `{완료일시}` is `YYYY.MM.DD HH:mm (KST)`. */
  notice: (completedAtLabel: string): string =>
    `${completedAtLabel}에 완료됐어요. 참여자 모두에게 메일로도 보내 드렸어요.`,
  /** Per-artifact name + one-line description. */
  items: {
    signed: { title: '최종 계약서', description: '서명이 모두 담긴 완료본이에요.' },
    certificate: {
      title: '감사 추적 인증서',
      description: '계약 이력과 문서 무결성을 증명하는 문서예요.',
    },
  } satisfies Record<CompletionArtifact, { title: string; description: string }>,
  /** Download button label (desktop / no file-share support). */
  cta: '내려받기',
  /** Action label when the browser can hand the file to the system share sheet. */
  shareCta: '공유',
  /** Shown while post-processing hasn't stored the artifacts yet. */
  preparing: '완료 문서를 준비하고 있어요. 잠시 후 다시 열어 주세요.',
  /** Neutral fallback when a download fails for an unknown reason. */
  error: '내려받지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const;

/** Ordered list of artifacts for rendering the two download rows. */
export const COMPLETION_ARTIFACTS: CompletionArtifact[] = ['signed', 'certificate'];

/**
 * Format an ISO timestamp as the absolute KST label `YYYY.MM.DD HH:mm (KST)`
 * (voice.md §2). Returns an empty string for an unparseable input.
 */
export function formatKstDateTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  // Shift to KST (UTC+9) and read the UTC parts of the shifted instant.
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`;
  const time = `${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
  return `${date} ${time} (KST)`;
}

/** Trigger a browser "save file" for a downloaded blob (best-effort filename). */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = filename;
  // Harmless everywhere; keeps the (unused) tab context isolated on the browsers
  // that ignore `download` and navigate instead.
  a.rel = 'noopener';
  // Build + click synchronously so the trigger stays inside the user gesture.
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  // iOS Safari cancels the download if the object URL is revoked before it has
  // finished reading the blob. The previous 0ms timeout raced that read; defer
  // the revoke well past the click so the save completes first (the URL is
  // reclaimed on unload regardless, so this leaks nothing meaningful).
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Whether the current browser can hand actual files to the OS share sheet.
 * `navigator.canShare({files})` is the reliable feature-detect (Web Share API
 * Level 2): iOS Safari and Android Chrome return true, desktop/legacy return
 * false. A capability probe (empty file) is enough for choosing the CTA label;
 * {@link deliverArtifact} re-checks with the real file before sharing.
 */
export function supportsFileShare(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    const probe = new File([new Uint8Array()], 'probe.pdf', { type: 'application/pdf' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** True when a rejected `navigator.share()` was just the user dismissing the sheet. */
function isShareDismissal(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Deliver a completed artifact to the user, choosing the best available path:
 *
 * 1. **Share** — on file-share-capable mobile browsers (iOS Safari, Android
 *    Chrome) open the native share sheet (`navigator.share({files})`), which
 *    offers "Save to Files"/AirDrop/Messages etc. This sidesteps the iOS Safari
 *    `a[download]` limitation (it ignores `download`, navigating the tab to the
 *    blob and dropping the signer's in-page session).
 * 2. **Download** — everywhere else fall back to {@link saveBlob}, preserving the
 *    exact existing desktop/legacy behavior.
 *
 * Progressive enhancement only: unsupported browsers are byte-for-byte unchanged.
 * A user-dismissed share sheet resolves quietly (not an error); any other share
 * failure falls through to the download path.
 */
export async function deliverArtifact(
  blob: Blob,
  filename: string,
  shareTitle?: string,
): Promise<void> {
  if (typeof window === 'undefined') return;
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: shareTitle ?? filename });
      return;
    } catch (err) {
      if (isShareDismissal(err)) return;
      // Any other share failure → best-effort download fallback below.
    }
  }
  saveBlob(blob, filename);
}
