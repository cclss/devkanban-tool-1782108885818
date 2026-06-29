'use client';

/**
 * LogoUploader — drag-and-drop + click logo upload with preview & removal.
 *
 * The component owns the *picking* experience (drop zone, click-to-browse,
 * cheap client-side type/size pre-checks, drag affordance) and delegates the
 * actual network upload/removal to the parent via `onSelect` / `onRemove`, so
 * the optimistic state and toast live in one place (`branding-settings`). The
 * server re-validates every byte (magic-byte sniffing); the client checks here
 * are only a fast, friendly first pass mirroring the same limits.
 */

import * as React from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import { BRANDING_COPY, resolveLogoSrc } from '@/lib/branding';

const L = BRANDING_COPY.logo;

/** Mirrors the server cap (`MAX_LOGO_BYTES`) for a fast local pre-check. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/svg+xml';
const ACCEPTED_EXT = /\.(png|jpe?g|svg)$/i;

/** Cheap, friendly pre-check; the server is the real validator. */
function localReject(file: File): string | null {
  const typeOk =
    /^image\/(png|jpeg|svg\+xml)$/.test(file.type) || ACCEPTED_EXT.test(file.name);
  if (!typeOk) return L.wrongTypeLocal;
  if (file.size > MAX_LOGO_BYTES) return L.tooLargeLocal;
  return null;
}

export function LogoUploader({
  value,
  uploading,
  onSelect,
  onRemove,
  disabled,
  id = 'brand-logo',
}: {
  value: string | null;
  uploading: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
  id?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const src = resolveLogoSrc(value);
  const busy = uploading || disabled;

  const accept = (file: File | undefined) => {
    if (!file) return;
    const reason = localReject(file);
    if (reason) {
      setLocalError(reason);
      return;
    }
    setLocalError(null);
    onSelect(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    accept(e.target.files?.[0]);
    // Allow re-selecting the same file later.
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    accept(e.dataTransfer.files?.[0]);
  };

  const openPicker = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  return (
    <div className="flex flex-col gap-xs">
      <span id={`${id}-label`} className="text-sm font-semibold text-foreground-muted">
        {L.label}
      </span>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={onInputChange}
      />

      {src && !uploading ? (
        // --- Preview state: show the current logo + replace/remove actions ---
        <div className="flex items-center gap-md rounded-md border border-border bg-surface p-md">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo, arbitrary content */}
            <img src={src} alt={L.previewAlt} className="h-full w-full object-contain" />
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-xs">
            <Button type="button" variant="secondary" size="sm" onClick={openPicker} disabled={busy}>
              {L.replace}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
              {L.remove}
            </Button>
          </div>
        </div>
      ) : (
        // --- Empty / uploading state: the drop zone ---
        <button
          type="button"
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          aria-labelledby={`${id}-label`}
          aria-busy={uploading || undefined}
          className={cn(
            'flex min-h-[7rem] w-full flex-col items-center justify-center gap-xs rounded-md border-2 border-dashed px-md py-lg text-center',
            'transition-[border-color,background-color] duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
            dragging ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-surface-muted',
            busy && 'cursor-default opacity-80',
          )}
        >
          {uploading ? (
            <span className="flex w-full max-w-[12rem] flex-col items-center gap-xs">
              <Skeleton className="h-2 w-full rounded-full" />
              <span className="text-sm font-medium text-foreground-subtle">{L.uploading}</span>
            </span>
          ) : (
            <>
              <UploadIcon />
              <span className="text-base font-semibold text-foreground">
                {dragging ? L.dropActive : L.drop}
              </span>
            </>
          )}
        </button>
      )}

      {localError ? (
        <p role="alert" className="text-sm text-danger">
          {localError}
        </p>
      ) : (
        <p className="text-sm text-foreground-subtle">{L.hint}</p>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-grey-400" fill="none" aria-hidden="true">
      <path
        d="M12 16V4m0 0L7 9m5-5 5 5M4 17v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
