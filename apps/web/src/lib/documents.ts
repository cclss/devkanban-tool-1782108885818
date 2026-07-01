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

import { apiDownload, apiFetch } from './api';
import { getToken } from './auth';
import {
  COMPLETION_DOWNLOAD_COPY,
  deliverArtifact,
  type CompletionArtifact,
} from './completion-download';

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
  const name = filename ?? `${fallbackTitle} (${COMPLETION_DOWNLOAD_COPY.items[kind].title}).pdf`;
  // Same shared delivery branch as the signer: native share sheet where the
  // browser supports it, download fallback otherwise.
  await deliverArtifact(blob, name, fallbackTitle);
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
