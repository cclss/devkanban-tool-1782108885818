'use client';

/**
 * TemplatePreviewDialog — a read-only look at a saved template's source PDF
 * (design-spec `components/template-preview-dialog/base.md`, copy
 * `tone/templates-list.md`).
 *
 * Opening it streams the template's original PDF via `fetchTemplateFile` and
 * renders the first page into the shared `PdfPreview` canvas. Its own state
 * machine — loading → (ready | error) — keeps it independent of the list: a
 * failed fetch surfaces the server's Korean copy with a 다시 시도 path, and a 401
 * bounces to /login like the rest of the app. Preview never mutates the template.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@repo/ui';
import { PdfPreview } from '@/components/wizard/pdf-preview';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { fetchTemplateFile, type TemplateSummary } from '@/lib/templates';
import { TEMPLATE_ACTIONS_COPY } from '@/lib/templates-copy';

const COPY = TEMPLATE_ACTIONS_COPY.preview_dialog;

type Status = 'loading' | 'ready' | 'error';

export interface TemplatePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template to preview; `null` while closed. */
  template: TemplateSummary | null;
}

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  template,
}: TemplatePreviewDialogProps) {
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>('loading');
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const templateId = template?.id ?? null;

  React.useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setFile(null);

    fetchTemplateFile(templateId)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [open, templateId, reloadKey, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-9">
            {template ? COPY.title(template.name) : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-sm">
          {status === 'loading' ? (
            <Skeleton className="mx-auto aspect-[1/1.414] w-full max-w-[420px]" />
          ) : null}

          {status === 'ready' && file ? (
            <PdfPreview file={file} className="mx-auto max-w-[420px]" />
          ) : null}

          {status === 'error' ? (
            <div className="flex flex-col items-center gap-md px-md py-2xl text-center">
              <p className="text-base text-foreground-muted">{error ?? COPY.error}</p>
              <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                {COPY.retry}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
