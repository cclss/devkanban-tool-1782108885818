'use client';

/**
 * RenameTemplateDialog — change a saved template's display name (design-spec
 * `components/save-template-dialog/rename.md`, copy `tone/templates-list.md`).
 *
 * Reuses the save dialog's modal composition (surface · title · description ·
 * single name input · cancel/save · error) but is a rename Extension: the input
 * is prefilled with the current name, and on submit it hands the new name up to
 * the page immediately — the `/templates` list applies the change optimistically,
 * so the async + rollback stay the page's job. Unlike a fire-and-close rename, the
 * modal then shows a success step instead of closing at once, offering two
 * equally-weighted choices: "계속 수정하기" (stay open, input left at the just-saved
 * name, ready for another edit) and "템플릿 목록으로 가기" (close; `/templates`
 * behind this modal is already current). This follows the spec's "저장 계열 동작이
 * 끝나면 시스템이 다음 화면을 자동으로 정하지 않는다" principle — same shape as
 * `SaveTemplateDialog`'s success step, minus the route push (there is no wizard to
 * return to here).
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
  SuccessCheck,
} from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { TEMPLATE_ACTIONS_COPY } from '@/lib/templates-copy';
import {
  canSaveRename,
  initialRenameTemplateFormState,
  renameTemplateReducer,
  resolveRenameSuccessChoice,
  type RenameSuccessChoice,
} from './rename-template-dialog-state';

const COPY = TEMPLATE_ACTIONS_COPY.rename_dialog;

export interface RenameTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The template being renamed; `null` while closed. Prefills the input. */
  template: TemplateSummary | null;
  /** Hand the trimmed new name up; the page renames optimistically. */
  onSubmit: (template: TemplateSummary, name: string) => void;
}

export function RenameTemplateDialog({
  open,
  onOpenChange,
  template,
  onSubmit,
}: RenameTemplateDialogProps) {
  const [form, dispatch] = React.useReducer(
    renameTemplateReducer,
    template?.name ?? '',
    initialRenameTemplateFormState,
  );
  const { name, status } = form;

  // Prefill with the current name each time the dialog opens for a template, so a
  // prior edit never leaks into the next rename. Does not re-fire while the
  // success step is showing (open/template are unchanged during that transition).
  React.useEffect(() => {
    if (open && template) dispatch({ type: 'OPEN', name: template.name });
  }, [open, template]);

  // The success step offers two equally-weighted choices and must not hand focus
  // to either by default — move focus to the (non-interactive) container instead,
  // mirroring the save dialog's success step.
  const successViewRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (status === 'success') {
      successViewRef.current?.focus();
    }
  }, [status]);

  const canSave = canSaveRename(form);
  const inputId = 'rename-template-name';

  const handleSubmit = () => {
    if (!template || !canSave) return;
    onSubmit(template, form.name.trim());
    dispatch({ type: 'SUBMIT' });
  };

  // Routes a rename-success choice per resolveRenameSuccessChoice: 'keep-editing'
  // resolves to false, so the dialog stays open on the (freshly re-armed) editing
  // step; 'go-to-templates' resolves to true, so only the dialog closes — the list
  // underneath is already current.
  const handleSuccessChoice = React.useCallback((choice: RenameSuccessChoice) => {
    if (resolveRenameSuccessChoice(choice)) {
      onOpenChange(false);
    } else {
      dispatch({ type: 'KEEP_EDITING' });
    }
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {status === 'success' ? (
          <div
            ref={successViewRef}
            tabIndex={-1}
            className="flex flex-col items-center gap-md py-sm text-center outline-none"
          >
            <SuccessCheck size={72} aria-label={COPY.successTitle} />
            <DialogHeader className="items-center pb-0">
              <DialogTitle>{COPY.successTitle}</DialogTitle>
              <DialogDescription>{COPY.successBody}</DialogDescription>
            </DialogHeader>
            <div className="flex w-full gap-sm">
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => handleSuccessChoice('keep-editing')}
              >
                {COPY.keepEditing}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => handleSuccessChoice('go-to-templates')}
              >
                {COPY.goToTemplates}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{COPY.title}</DialogTitle>
              <DialogDescription>{COPY.description}</DialogDescription>
            </DialogHeader>

            <Field label={COPY.nameLabel} htmlFor={inputId}>
              <Input
                id={inputId}
                value={name}
                onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
                placeholder={COPY.namePlaceholder}
                maxLength={80}
                autoFocus
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                {COPY.cancel}
              </Button>
              <Button type="submit" disabled={!canSave}>
                {COPY.save}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
