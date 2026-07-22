'use client';

/**
 * DeleteTemplateDialog — confirm the irreversible deletion of a saved template
 * (design-spec `components/confirm-dialog/base.md`, copy `tone/templates-list.md`).
 *
 * A destructive confirm: it names the consequence plainly ('삭제하면 되돌릴 수
 * 없어요'), reassures that already-sent contracts are untouched, and offers a calm
 * way out (취소). The confirm action is a `danger` Button. On confirm it hands the
 * template up and closes at once — the `/templates` list removes it optimistically,
 * so the async delete + rollback are the page's job, not the modal's.
 */

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { TEMPLATE_ACTIONS_COPY } from '@/lib/templates-copy';

const COPY = TEMPLATE_ACTIONS_COPY.delete_dialog;

export interface DeleteTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template pending deletion; `null` while closed. */
  template: TemplateSummary | null;
  /** Hand the template up; the page deletes optimistically and closes. */
  onConfirm: (template: TemplateSummary) => void;
}

export function DeleteTemplateDialog({
  open,
  onOpenChange,
  template,
  onConfirm,
}: DeleteTemplateDialogProps) {
  const handleConfirm = () => {
    if (!template) return;
    onConfirm(template);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? COPY.title(template.name) : ''}</DialogTitle>
          <DialogDescription>{COPY.description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {COPY.cancel}
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            {COPY.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
