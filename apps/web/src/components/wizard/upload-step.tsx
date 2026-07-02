'use client';

/**
 * Wizard step 1 — upload the contract document (PDF or DOCX).
 *
 * Drag-and-drop or file-pick a PDF/DOCX, with client-side guards (type / size /
 * empty) that mirror the server's Korean copy (apps/api/src/common/messages.ts)
 * so the user gets the same wording instantly, before any round-trip. On a valid
 * pick the file uploads with a live progress bar; the resulting DRAFT document +
 * the local File land in wizard state, and the first page renders as a preview.
 */

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { uploadPdf, type UploadProgress } from '@/lib/upload';
import { useWizard } from './wizard-context';
import { PdfPreview } from './pdf-preview';

const MAX_BYTES = 20 * 1024 * 1024;

/** Canonical DOCX (OOXML WordprocessingML) MIME — mirrors the server's DOCX_MIME. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** `accept` attribute for the file input — PDF and DOCX by MIME + extension. */
const ACCEPT = `application/pdf,.pdf,${DOCX_MIME},.docx`;

/** Client-side guard copy — kept in lockstep with the server messages. */
const GUARD = {
  invalidType: 'PDF 또는 DOCX 파일만 업로드할 수 있어요.',
  tooLarge: '파일이 너무 커요. 20MB 이하의 파일로 올려 주세요.',
  empty: '파일이 비어 있어요. 다른 파일로 다시 시도해 주세요.',
} as const;

/** Validate a picked file; returns a Korean guard message, or null if OK. */
function validateDocument(file: File): string | null {
  const name = file.name.toLowerCase();
  const isSupported =
    file.type === 'application/pdf' ||
    file.type === DOCX_MIME ||
    name.endsWith('.pdf') ||
    name.endsWith('.docx');
  if (!isSupported) return GUARD.invalidType;
  if (file.size === 0) return GUARD.empty;
  if (file.size > MAX_BYTES) return GUARD.tooLarge;
  return null;
}

/** True for a DOCX pick — DOCX has no visual preview yet (out of scope). */
function isDocx(file: File): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

type Phase = 'idle' | 'uploading' | 'done';

export function UploadStep() {
  const { state, dispatch } = useWizard();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const [dragActive, setDragActive] = React.useState(false);
  const [progress, setProgress] = React.useState<UploadProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Filename shown while uploading (before the document summary exists).
  const [pendingName, setPendingName] = React.useState<string | null>(null);

  const phase: Phase = state.document ? 'done' : progress ? 'uploading' : 'idle';

  // Abort any in-flight upload if the step unmounts.
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const startUpload = React.useCallback(
    async (file: File) => {
      const guard = validateDocument(file);
      if (guard) {
        setError(guard);
        return;
      }
      setError(null);
      setPendingName(file.name);
      setProgress({ loaded: 0, total: file.size, pct: 0 });

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const document = await uploadPdf(file, {
          token: getToken() ?? undefined,
          signal: controller.signal,
          onProgress: setProgress,
        });
        dispatch({ type: 'SET_DOCUMENT', document, file });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        abortRef.current = null;
        setProgress(null);
        setPendingName(null);
      }
    },
    [dispatch],
  );

  const onFiles = React.useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void startUpload(file);
    },
    [startUpload],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      if (phase === 'uploading') return;
      onFiles(event.dataTransfer.files);
    },
    [onFiles, phase],
  );

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    setError(null);
    dispatch({ type: 'CLEAR_DOCUMENT' });
    if (inputRef.current) inputRef.current.value = '';
  }, [dispatch]);

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">계약 문서를 올려 주세요</h2>
        <p className="text-sm text-foreground-subtle">
          서명을 받을 PDF 또는 DOCX 문서를 끌어다 놓거나 직접 선택하세요. 최대 20MB까지 올릴 수 있어요.
        </p>
      </div>

      {phase === 'done' && state.file ? (
        <UploadedView
          fileName={state.document?.title ?? state.file.name}
          fileSize={state.file.size}
          pageCount={state.document?.pageCount ?? 0}
          file={state.file}
          onReplace={reset}
          onPageCount={(n) => {
            // Backfill page count if the server returned 0 (it parses lazily).
            if (state.document && state.document.pageCount === 0 && n > 0) {
              dispatch({ type: 'SET_DOCUMENT', document: { ...state.document, pageCount: n }, file: state.file as File });
            }
          }}
        />
      ) : phase === 'uploading' ? (
        <UploadingView
          fileName={pendingName ?? ''}
          progress={progress}
          onCancel={reset}
        />
      ) : (
        <DropZone
          dragActive={dragActive}
          inputRef={inputRef}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onChange={(e) => onFiles(e.target.files)}
        />
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DropZone({
  dragActive,
  inputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  onChange,
}: {
  dragActive: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-sm rounded-lg border-2 border-dashed px-md py-3xl text-center',
        'transition-colors duration-base ease-standard',
        'focus-within:ring-4 focus-within:ring-focus',
        dragActive
          ? 'border-primary bg-primary-subtle'
          : 'border-border-strong bg-surface-muted hover:border-primary hover:bg-primary-subtle/40',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={onChange}
      />
      <span
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-base',
          dragActive ? 'bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary',
        )}
      >
        <UploadIcon />
      </span>
      <div className="flex flex-col gap-2xs">
        <span className="text-base font-bold text-foreground">
          {dragActive ? '여기에 놓으면 업로드돼요' : 'PDF나 DOCX를 끌어다 놓으세요'}
        </span>
        <span className="text-sm text-foreground-subtle">또는 클릭해서 파일을 선택하세요</span>
      </div>
      <span className="pointer-events-none mt-2xs inline-flex h-9 items-center rounded-md bg-surface px-md text-sm font-semibold text-primary shadow-sm">
        파일 선택
      </span>
    </label>
  );
}

function UploadingView({
  fileName,
  progress,
  onCancel,
}: {
  fileName: string;
  progress: UploadProgress | null;
  onCancel: () => void;
}) {
  const pct = progress?.pct ?? 0;
  // The upload byte-stream finishes before the server parses pages; past 100%
  // we switch to an indeterminate "preparing" message instead of a stuck bar.
  const preparing = pct >= 100;

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-lg">
      <div className="flex items-center gap-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <FileIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="truncate text-sm font-semibold text-foreground">{fileName}</span>
          <span className="text-xs text-foreground-subtle">
            {preparing ? '문서를 준비하고 있어요' : `업로드 중 ${pct}%`}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          취소
        </Button>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-grey-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={preparing ? undefined : pct}
        aria-label="업로드 진행률"
      >
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-[width] duration-base ease-out-expressive',
            preparing && 'animate-pulse',
          )}
          style={{ width: `${Math.max(pct, preparing ? 100 : 4)}%` }}
        />
      </div>
    </div>
  );
}

function UploadedView({
  fileName,
  fileSize,
  pageCount,
  file,
  onReplace,
  onPageCount,
}: {
  fileName: string;
  fileSize: number;
  pageCount: number;
  file: File;
  onReplace: () => void;
  onPageCount: (pageCount: number) => void;
}) {
  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center gap-sm rounded-lg border border-border bg-surface p-md">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success-subtle text-success">
          <CheckIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="truncate text-sm font-semibold text-foreground">{fileName}</span>
          <span className="text-xs text-foreground-subtle">
            {[formatBytes(fileSize), pageCount > 0 ? `${pageCount}페이지` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onReplace}>
          다른 파일
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface-muted p-md">
        {isDocx(file) ? (
          // DOCX body preview is out of scope for now — show an honest, neutral
          // note rather than running the PDF renderer (which would misreport a
          // valid DOCX as a broken PDF).
          <div className="flex flex-col items-center justify-center gap-xs px-md py-xl text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface text-foreground-muted">
              <FileIcon />
            </span>
            <p className="text-sm text-foreground-subtle">
              DOCX 문서는 미리보기를 제공하지 않아요. 업로드는 완료됐어요.
            </p>
          </div>
        ) : (
          <PdfPreview file={file} onPageCount={onPageCount} className="mx-auto max-w-[560px]" />
        )}
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M5 10.5 8.5 14 15 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
