'use client';

/**
 * LogoUploader — drag-and-drop (or pick) the brand logo with a live progress
 * bar, a preview thumbnail, and replace/delete.
 *
 * Upload/delete hit their own endpoints (`POST`/`DELETE /branding/logo`) and
 * apply immediately — independent of the color/font Save. Client-side guards
 * mirror the server's format/size copy so feedback is instant; a chosen file
 * shows an optimistic local thumbnail (object URL) until the server URL lands.
 *
 * Visual values are tokens only; the thumbnail is the user's image (runtime
 * content). Upload is open to every plan — signer-screen application is gated
 * elsewhere — so `disabled` is only for transient states, not a plan lock.
 */

import * as React from 'react';
import { Button, Field, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import {
  BRANDING_COPY,
  LOGO_ACCEPT,
  deleteLogo,
  uploadLogo,
  validateLogo,
  type BrandingView,
  type UploadProgress,
} from '@/lib/branding-settings';
import type { ToastTone } from './toast';

export function LogoUploader({
  logoUrl,
  disabled = false,
  onChange,
  onLocalPreview,
  notify,
}: {
  logoUrl: string | null;
  disabled?: boolean;
  /** Receives the fresh BrandingView after an upload or delete. */
  onChange: (view: BrandingView) => void;
  /** Optimistic local thumbnail URL (or null to clear) for the live preview. */
  onLocalPreview: (url: string | null) => void;
  notify: (tone: ToastTone, message: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);

  const [dragActive, setDragActive] = React.useState(false);
  const [progress, setProgress] = React.useState<UploadProgress | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const phase = progress ? 'uploading' : logoUrl ? 'has' : 'idle';

  const clearObjectUrl = React.useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    onLocalPreview(null);
  }, [onLocalPreview]);

  // Abort any in-flight upload + revoke the object URL on unmount.
  React.useEffect(
    () => () => {
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const startUpload = React.useCallback(
    async (file: File) => {
      const guard = validateLogo(file);
      if (guard) {
        setError(guard);
        notify('error', guard);
        return;
      }
      setError(null);

      // Optimistic local thumbnail while the bytes travel.
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      onLocalPreview(url);
      setProgress({ loaded: 0, total: file.size, pct: 0 });

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const view = await uploadLogo(file, { signal: controller.signal, onProgress: setProgress });
        onChange(view);
        notify('success', BRANDING_COPY.logo.uploadedToast);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof ApiError ? err.message : BRANDING_COPY.saveErrorToast;
        setError(message);
        notify('error', message);
      } finally {
        abortRef.current = null;
        setProgress(null);
        clearObjectUrl();
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [clearObjectUrl, notify, onChange, onLocalPreview],
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
      if (disabled || phase === 'uploading') return;
      onFiles(event.dataTransfer.files);
    },
    [disabled, onFiles, phase],
  );

  const onRemove = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await deleteLogo();
      onChange(view);
      notify('success', BRANDING_COPY.logo.removedToast);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : BRANDING_COPY.saveErrorToast;
      setError(message);
      notify('error', message);
    } finally {
      setBusy(false);
    }
  }, [notify, onChange]);

  return (
    <Field label={BRANDING_COPY.logo.label} hint={BRANDING_COPY.logo.note} error={error ?? undefined}>
      {phase === 'uploading' ? (
        <UploadingView fileProgress={progress} />
      ) : phase === 'has' && logoUrl ? (
        <div className="flex items-center gap-md rounded-lg border border-border bg-surface p-md">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- runtime sender logo, arbitrary host */}
            <img src={logoUrl} alt={BRANDING_COPY.logo.thumbAlt} className="h-full w-full object-contain" />
          </span>
          <div className="flex flex-1 flex-wrap items-center gap-xs">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {BRANDING_COPY.logo.replace}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              isLoading={busy}
              disabled={disabled || busy}
              onClick={() => void onRemove()}
            >
              {BRANDING_COPY.logo.remove}
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            disabled={disabled}
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragActive(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-sm rounded-lg border-2 border-dashed px-md py-2xl text-center',
            'transition-colors duration-base ease-standard',
            'focus-within:ring-4 focus-within:ring-focus',
            disabled
              ? 'cursor-not-allowed border-border bg-surface-muted opacity-60'
              : dragActive
                ? 'cursor-pointer border-primary bg-primary-subtle'
                : 'cursor-pointer border-border-strong bg-surface-muted hover:border-primary hover:bg-primary-subtle/40',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="sr-only"
            disabled={disabled}
            onChange={(e) => onFiles(e.target.files)}
          />
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-base ease-standard',
              dragActive ? 'bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary',
            )}
          >
            <UploadIcon />
          </span>
          <div className="flex flex-col gap-2xs">
            <span className="text-base font-bold text-foreground">
              {dragActive ? BRANDING_COPY.logo.dropActive : BRANDING_COPY.logo.dropTitle}
            </span>
            <span className="text-sm text-foreground-subtle">{BRANDING_COPY.logo.dropHint}</span>
          </div>
          <span className="pointer-events-none mt-2xs inline-flex h-9 items-center rounded-md bg-surface px-md text-sm font-semibold text-primary shadow-sm">
            {BRANDING_COPY.logo.pick}
          </span>
        </label>
      )}
    </Field>
  );
}

function UploadingView({ fileProgress }: { fileProgress: UploadProgress | null }) {
  const pct = fileProgress?.pct ?? 0;
  const preparing = pct >= 100;

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-lg">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          {preparing ? BRANDING_COPY.logo.preparing : `${BRANDING_COPY.logo.uploading} ${pct}%`}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-grey-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={preparing ? undefined : pct}
        aria-label={BRANDING_COPY.logo.uploading}
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

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
