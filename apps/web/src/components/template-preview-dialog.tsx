'use client';

/**
 * TemplatePreviewDialog — a read-only look at a saved template's source PDF with
 * its field layout overlaid (design-spec `components/template-preview-dialog/base.md`,
 * copy `lib/templates-copy.ts` `preview_dialog`, tone `tone/templates-list.md`).
 *
 * The list hands it a `TemplateSummary` (no field layout). Opening the dialog
 * loads the rest — the full field array + pageCount via `getTemplate(id)` and the
 * original PDF bytes via `fetchTemplateFile(id)` — in parallel, then mounts the
 * grain's read-only `TemplateFieldPreview` surface so the sender can confirm where
 * each signature/date/text field sits, page by page. Preview never mutates the
 * template: it only *reads* the stored geometry.
 *
 * Its own state machine — loading → (ready | error) — keeps it independent of the
 * list: a failed load surfaces the server's Korean copy with a 다시 시도 path, and
 * a 401 bounces to /login like the rest of the app.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@repo/ui';
import { TemplateFieldPreview } from '@/components/template-field-preview';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import {
  fetchTemplateFile,
  getTemplate,
  type TemplateField,
  type TemplateSummary,
} from '@/lib/templates';
import { TEMPLATE_ACTIONS_COPY } from '@/lib/templates-copy';

const COPY = TEMPLATE_ACTIONS_COPY.preview_dialog;

type Status = 'loading' | 'ready' | 'error';

/** The source PDF + saved layout the preview surface needs, loaded on open. */
interface PreviewData {
  file: File;
  fields: TemplateField[];
}

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
  const [data, setData] = React.useState<PreviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const templateId = template?.id ?? null;

  React.useEffect(() => {
    if (!open || !templateId) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setData(null);

    // Load the field layout and the PDF bytes together — both are needed before
    // the overlay can render, and neither depends on the other.
    Promise.all([getTemplate(templateId), fetchTemplateFile(templateId)])
      .then(([detail, file]) => {
        if (cancelled) return;
        setData({ file, fields: detail.fields });
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
          <DialogDescription>{COPY.description}</DialogDescription>
        </DialogHeader>

        <div className="mt-sm">
          {status === 'loading' ? (
            <Skeleton className="mx-auto aspect-[1/1.414] w-full max-w-[420px]" />
          ) : null}

          {status === 'ready' && data ? (
            <TemplateFieldPreview
              file={data.file}
              fields={data.fields}
              maxWidth={420}
              className="mx-auto max-w-[420px]"
            />
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
