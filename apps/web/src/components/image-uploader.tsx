'use client';

/**
 * ImageUploader — the reusable branding image control (로고 · 파비콘 공용).
 *
 * A controlled, presentation-only component: the parent owns the picked `File`
 * (`value` / `onChange`), and this renders one of three states — default
 * (drop / pick), preview (thumbnail + filename + remove/replace), and an inline
 * error when a pick violates the format/size constraints. There is no network
 * here; validation and the local object-URL preview are all that happen (the
 * actual upload lands with the branding form, a later grain).
 *
 * Visuals reuse the wizard drop-zone treatment (components/wizard/upload-step)
 * and the danger tokens the Input primitive uses for its invalid state — no new
 * colors, spacing, or radii. Labels come in as props so the same control serves
 * both 로고 and 파비콘 (copy is owned by the form, not this component).
 */

import * as React from 'react';
import { Button, Field, cn } from '@repo/ui';
import {
  validateImageFile,
  formatImageSize,
  IMAGE_CONSTRAINT_HINT,
  IMAGE_ACCEPT_ATTR,
} from '@/lib/image-validation';

export interface ImageUploaderProps {
  /** Ties the field label to the file input. Must be unique per uploader. */
  id: string;
  /** Field label, e.g. `로고` / `파비콘`. Supplied by the form (settings copy). */
  label: React.ReactNode;
  /** Constraint hint under the field. Defaults to the format · size line. */
  hint?: React.ReactNode;
  /** The currently held file, or `null` when nothing is selected. */
  value: File | null;
  /** Called with a valid file on pick, or `null` on remove. */
  onChange: (file: File | null) => void;
  className?: string;
}

export function ImageUploader({
  id,
  label,
  hint,
  value,
  onChange,
  className,
}: ImageUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  // Derive a local preview URL from the held file; revoke it on change/unmount
  // so blobs never leak.
  React.useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      // Reset so re-picking the same file fires `change` again.
      if (inputRef.current) inputRef.current.value = '';
      if (!file) return;
      const message = validateImageFile(file);
      if (message) {
        // Keep any previously valid selection; just surface what's wrong.
        setError(message);
        return;
      }
      setError(null);
      onChange(file);
    },
    [onChange],
  );

  const handleRemove = React.useCallback(() => {
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  }, [onChange]);

  const triggerPick = React.useCallback(() => inputRef.current?.click(), []);

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const labelText = typeof label === 'string' ? label : undefined;

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint ?? IMAGE_CONSTRAINT_HINT}
      error={error}
      className={className}
    >
      {/* One hidden input, always mounted, drives both pick and replace. */}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        aria-invalid={error ? true : undefined}
        className="peer sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {value && previewUrl ? (
        <div
          className={cn(
            'flex items-center gap-sm rounded-lg border bg-surface p-md',
            error ? 'border-danger' : 'border-border',
          )}
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
            {/* Filename beside it carries the accessible name; the thumb is decorative. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2xs">
            <span className="truncate text-sm font-semibold text-foreground">{value.name}</span>
            <span className="text-xs text-foreground-subtle">{formatImageSize(value.size)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2xs">
            <Button variant="ghost" size="sm" onClick={triggerPick}>
              다른 파일
            </Button>
            <Button variant="ghost" size="sm" onClick={handleRemove}>
              제거
            </Button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-sm rounded-lg border-2 border-dashed px-md py-2xl text-center',
            'transition-colors duration-base ease-standard',
            'peer-focus-visible:ring-4 peer-focus-visible:ring-focus',
            error
              ? 'border-danger bg-danger-subtle/40'
              : dragActive
                ? 'border-primary bg-primary-subtle'
                : 'border-border-strong bg-surface-muted hover:border-primary hover:bg-primary-subtle/40',
          )}
        >
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-base',
              dragActive ? 'bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary',
            )}
          >
            <ImageIcon />
          </span>
          <div className="flex flex-col gap-2xs">
            <span className="text-sm font-bold text-foreground">
              {dragActive
                ? '여기에 놓으면 올라가요'
                : `${labelText ? `${labelText} 이미지를 ` : '이미지를 '}끌어다 놓으세요`}
            </span>
            <span className="text-xs text-foreground-subtle">또는 클릭해서 파일을 선택하세요</span>
          </div>
          <span className="pointer-events-none mt-2xs inline-flex h-9 items-center rounded-md bg-surface px-md text-sm font-semibold text-primary shadow-sm">
            파일 선택
          </span>
        </label>
      )}
    </Field>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" />
      <path
        d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17m-2-3 1.5-1.5a2 2 0 0 1 2.8 0L21 15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
