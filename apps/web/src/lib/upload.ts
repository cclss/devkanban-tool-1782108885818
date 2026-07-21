/**
 * Multipart PDF upload with progress.
 *
 * The shared `apiFetch` helper (lib/api.ts) is great for JSON, but `fetch` can't
 * report upload progress, and the upload step shows a real progress bar. So this
 * uses `XMLHttpRequest`, while mirroring `apiFetch`'s contract: it hits the same
 * `/api` base, sends the bearer token, and surfaces the server's Korean error
 * copy verbatim (falling back to the neutral generic line on a transport error).
 *
 * Endpoint: `POST /api/documents/upload` (field name `file`) →
 * `DocumentSummary` (a DRAFT document). See documents.controller.ts.
 */

import { API_ORIGIN, ApiError, GENERIC_ERROR } from './api';
import type { DocumentSummary } from './documents';

// Reuse the normalized origin from lib/api so `/api` is appended exactly once
// (a deploy value carrying `/api` would otherwise yield `/api/api`).
const API_BASE = `${API_ORIGIN}/api`;

export interface UploadProgress {
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes to transfer (0 until known). */
  total: number;
  /** Whole-percent 0–100 (0 while the total is still unknown). */
  pct: number;
}

export interface UploadPdfOptions {
  token?: string;
  onProgress?: (progress: UploadProgress) => void;
  /** Abort the in-flight upload (e.g. the user removes the file). */
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

export function uploadPdf(file: File, options: UploadPdfOptions = {}): Promise<DocumentSummary> {
  const { token, onProgress, signal } = options;

  return new Promise<DocumentSummary>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/documents/upload`);
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
          resolve(JSON.parse(xhr.responseText) as DocumentSummary);
        } catch {
          reject(new ApiError(GENERIC_ERROR, xhr.status));
        }
        return;
      }
      reject(new ApiError(message ?? GENERIC_ERROR, xhr.status));
    };

    xhr.onerror = () => {
      cleanup();
      // Network / CORS / server-down — never expose the raw error.
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
