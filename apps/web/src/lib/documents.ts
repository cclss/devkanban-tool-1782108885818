/**
 * Dashboard data access for the sender's contracts.
 *
 * Thin wrappers over the authenticated `/documents` endpoints (see
 * `apps/api/src/documents/documents.controller.ts`). Response shapes mirror the
 * server's `DocumentSummary` / quota DTOs so the dashboard binds to them directly.
 *
 * The "sent signal" is the hand-off contract with the (future) send wizard
 * (grain-6~9): right before it routes back to `/dashboard`, the wizard stashes
 * the just-sent contract here so the list can show it as '진행 중' immediately —
 * an optimistic prepend that survives even before the network re-fetch lands.
 */

import { apiDownload, apiFetch, apiUrl } from './api';
import { getToken } from './auth';
import {
  COMPLETION_DOWNLOAD_COPY,
  saveBlob,
  type CompletionArtifact,
} from './completion-download';
import type { PdfSource } from './pdf';

export type DocumentStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface DocumentSummary {
  id: string;
  title: string;
  status: DocumentStatus;
  /** Korean status label, authored server-side (single source of truth). */
  statusLabel: string;
  pageCount: number;
  recipientCount: number;
  sentAt: string | null;
  createdAt: string;
  /** ISO completion timestamp once fully signed (else null). */
  completedAt: string | null;
  /** True when both completion artifacts are stored and downloadable. */
  downloadsReady: boolean;
}

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
}

export function fetchDocuments(): Promise<DocumentSummary[]> {
  return apiFetch<DocumentSummary[]>('/documents', { token: getToken() ?? undefined });
}

export function fetchQuota(): Promise<Quota> {
  return apiFetch<Quota>('/documents/quota', { token: getToken() ?? undefined });
}

// --- render source (PDF vs converted DOCX) ---------------------------------

/** Canonical DOCX (OOXML WordprocessingML) MIME — mirrors the server's DOCX_MIME. */
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** True for a DOCX pick (by MIME or extension) — its bytes can't be rendered by pdf.js. */
export function isDocxFile(file: File): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx');
}

/** Absolute URL of a document's canonical render PDF (owner-only, inline stream). */
export function documentContentUrl(documentId: string): string {
  return apiUrl(`/documents/${encodeURIComponent(documentId)}/content`);
}

/**
 * Copy shown if the converted document (DOCX → server PDF) can't be loaded for
 * preview/placement. Distinct from the PDF-upload "corrupt PDF" line: here the
 * user uploaded a DOCX, so the message stays honest (converted document) and
 * offers the next action (retry) without exposing the conversion internals.
 * Single-source with the server's Toss-tone voice — see design-spec messaging.
 */
export const CONVERTED_DOC_LOAD_ERROR =
  '변환한 문서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * What the editor's PDF renderer should open for this document:
 *   • PDF upload  → the local File (original path — bytes never leave the client).
 *   • DOCX upload → the server's converted canonical PDF, streamed from
 *     `:id/content` with the owner's bearer token (the placement canvas renders
 *     the exact bytes analysis ran against).
 * The branch is limited to the DOCX case; PDF rendering is unchanged.
 */
export function documentRenderSource(documentId: string, file: File): PdfSource {
  if (!isDocxFile(file)) return { kind: 'file', file };
  const token = getToken();
  return {
    kind: 'url',
    url: documentContentUrl(documentId),
    init: {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    },
    loadErrorMessage: CONVERTED_DOC_LOAD_ERROR,
  };
}

// --- AI field analysis (grain-4) -------------------------------------------

/**
 * One AI/heuristic-proposed field from `POST /documents/:id/analyze`. Geometry is
 * already normalized (0..1, bottom-left origin) with a 1-based page — the exact
 * shape the wizard persists via `PUT :id/fields` — so the client trusts the
 * server contract verbatim and never re-normalizes (grain-3 contract).
 */
export interface AnalyzedField {
  type: 'SIGNATURE' | 'DATE' | 'TEXT';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  recipientIndex: number;
}

/** Response of `POST /documents/:id/analyze`: proposed fields + analysis meta. */
export interface AnalyzeResult {
  fields: AnalyzedField[];
  meta: {
    /** `'ai'`/`'heuristic'` produced fields; `'none'` = analysis could not run. */
    source: 'ai' | 'heuristic' | 'none';
    analyzedAt: string;
    fieldCount: number;
    /** Toss-tone Korean guidance, present only when `fields` is empty. */
    reason?: string;
  };
}

/**
 * Ask the server to auto-detect signature/date/text fields on a DRAFT document.
 *
 * The endpoint always answers `200` — an empty result or an analysis failure
 * comes back as `{ fields: [], meta.reason }`, never an error — so a missing
 * suggestion never blocks manual placement. Only auth/ownership/state guard
 * violations reject (surfaced as the server's Korean `ApiError` copy).
 */
export function analyzeDocument(documentId: string): Promise<AnalyzeResult> {
  return apiFetch<AnalyzeResult>(`/documents/${encodeURIComponent(documentId)}/analyze`, {
    method: 'POST',
    token: getToken() ?? undefined,
  });
}

/**
 * Download a completed contract's artifact as the signed-in owner and hand it to
 * the browser's "save file". Rejects with the server's Toss-tone message (e.g.
 * the artifacts aren't ready yet) so the caller can surface a friendly retry.
 */
export async function downloadOwnerArtifact(
  documentId: string,
  kind: CompletionArtifact,
  fallbackTitle: string,
): Promise<void> {
  const { blob, filename } = await apiDownload(
    `/documents/${encodeURIComponent(documentId)}/download/${kind}`,
    { token: getToken() ?? undefined },
  );
  saveBlob(blob, filename ?? `${fallbackTitle} (${COMPLETION_DOWNLOAD_COPY.items[kind].title}).pdf`);
}

// --- optimistic "just sent" hand-off ---------------------------------------

const SENT_SIGNAL_KEY = 'esign.sentContract';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Called by the send wizard just before redirecting to the dashboard. */
export function writeSentSignal(summary: DocumentSummary): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(SENT_SIGNAL_KEY, JSON.stringify(summary));
  } catch {
    // Storage may be unavailable (private mode / quota); the network re-fetch
    // still surfaces the contract, so this is a best-effort optimization.
  }
}

/** Read-and-clear the one-shot signal so it only optimistically shows once. */
export function takeSentSignal(): DocumentSummary | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(SENT_SIGNAL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SENT_SIGNAL_KEY);
    return JSON.parse(raw) as DocumentSummary;
  } catch {
    return null;
  }
}
