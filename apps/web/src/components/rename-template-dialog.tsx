'use client';

/**
 * RenameTemplateDialog — change a saved template's display name (design-spec
 * `components/save-template-dialog/rename.md`, copy `tone/templates-list.md`).
 *
 * Reuses the save dialog's modal composition (surface · title · description ·
 * single name input · cancel/save · error) but is a rename Extension: the input
 * is prefilled with the current name, and on submit it hands the new name up and
 * closes at once — the `/templates` list applies the change optimistically, so
 * there is no in-modal success block. Only client-side guards live here (empty /
 * unchanged name); the async + rollback are the page's job.
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
  Field,
  Input,
} from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { useTranslation } from '@/components/locale-provider';

export interface RenameTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template being renamed; `null` while closed. Prefills the input. */
  template: TemplateSummary | null;
  /** Hand the trimmed new name up; the page renames optimistically and closes. */
  onSubmit: (template: TemplateSummary, name: string) => void;
}

export function RenameTemplateDialog({
  open,
  onOpenChange,
  template,
  onSubmit,
}: RenameTemplateDialogProps) {
  const t = useTranslation();
  const [name, setName] = React.useState('');

  // Prefill with the current name each time the dialog opens for a template, so a
  // prior edit never leaks into the next rename.
  React.useEffect(() => {
    if (open && template) setName(template.name);
  }, [open, template]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== template?.name;
  const inputId = 'rename-template-name';

  const handleSubmit = () => {
    if (!template || !canSave) return;
    onSubmit(template, trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('templates.renameTitle')}</DialogTitle>
            <DialogDescription>{t('templates.renameDescription')}</DialogDescription>
          </DialogHeader>

          <Field label={t('templates.renameNameLabel')} htmlFor={inputId}>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('templates.renameNamePlaceholder')}
              maxLength={80}
              autoFocus
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('templates.renameCancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {t('templates.renameSave')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
