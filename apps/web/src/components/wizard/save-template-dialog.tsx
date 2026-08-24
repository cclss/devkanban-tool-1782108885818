'use client';

/**
 * SaveTemplateDialog — name-and-save the wizard's current PDF + field layout as
 * a reusable template (design-spec `components/save-template-dialog/base.md`,
 * copy `messaging/save-template.md`).
 *
 * One modal, one task: the sender types a name and saves. The dialog reads the
 * wizard's placement state (storageKey · pageCount · fields) but never mutates
 * it — saving a template is a side-branch off the send flow, so the fields and
 * the in-progress draft are left exactly as they were.
 *
 * State machine: idle → saving → (success | error). On success the form is
 * replaced by a confirmation so the sender gets unambiguous feedback before the
 * modal closes; on failure the server's Korean copy surfaces verbatim (e.g. the
 * plan's template limit — '저장할 수 있는 템플릿 수를 …') and the sender can retry.
 * A 401 means the session lapsed, so we bounce to /login like the send flow.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { createTemplate } from '@/lib/templates';
import type { SignFieldDraft } from './wizard-context';
import {
  canSubmit,
  initialSaveTemplateFormState,
  isCancelDisabled,
  isNameInputDisabled,
  isSaveDisabled,
  resolveSaveSuccessRoute,
  saveTemplateReducer,
  shouldBlockOpenChange,
  type SaveSuccessChoice,
} from './save-template-dialog-state';

const COPY = {
  title: '템플릿으로 저장',
  description: '지금 배치한 필드 그대로 저장해 두면, 다음에 같은 양식을 바로 불러올 수 있어요.',
  nameLabel: '템플릿 이름',
  namePlaceholder: '예: 표준 근로계약서',
  nameHint: '나중에 목록에서 찾기 쉬운 이름을 붙여 주세요.',
  cancel: '취소',
  save: '저장',
  saving: '저장 중',
  retry: '다시 시도',
  successTitle: '템플릿을 저장했어요',
  successBody: "다음에 '내 템플릿'에서 바로 불러올 수 있어요.",
  continueSending: '계속 발송하기',
  goToTemplates: '템플릿 목록으로 가기',
} as const;

export interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Storage key of the already-uploaded source PDF (reused when sending). */
  storageKey: string;
  /** Page count of the source PDF; omitted when not yet known. */
  pageCount?: number;
  /** The wizard's current placed fields, saved verbatim into the template. */
  fields: SignFieldDraft[];
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  storageKey,
  pageCount,
  fields,
}: SaveTemplateDialogProps) {
  const router = useRouter();
  const [form, dispatch] = React.useReducer(saveTemplateReducer, initialSaveTemplateFormState);
  const { name, status, error } = form;

  // Reset to a clean form whenever the modal (re)opens, so a prior name/error
  // never leaks into the next save.
  React.useEffect(() => {
    if (open) {
      dispatch({ type: 'OPEN' });
    }
  }, [open]);

  const trimmed = name.trim();

  // The success screen offers two equally-weighted choices and must not
  // hand focus to either one by default (autoFocus would defeat that). Radix's
  // focus trap otherwise lands on the first focusable element on mount, so we
  // move focus to the (non-interactive) container instead.
  const successViewRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (status === 'success') {
      successViewRef.current?.focus();
    }
  }, [status]);

  // Routes a save-success choice per resolveSaveSuccessRoute: 'continue-sending'
  // resolves to null, so only the dialog closes and the sender stays on the
  // wizard's field layout screen with fields untouched; 'go-to-templates'
  // resolves to a route, so only that navigation happens.
  const handleSuccessChoice = React.useCallback(
    (choice: SaveSuccessChoice) => {
      const route = resolveSaveSuccessRoute(choice);
      if (route) {
        router.push(route);
      } else {
        onOpenChange(false);
      }
    },
    [router, onOpenChange],
  );

  const handleSave = React.useCallback(async () => {
    if (!canSubmit(form)) return;
    dispatch({ type: 'SUBMIT' });
    try {
      await createTemplate({ name: trimmed, storageKey, pageCount, fields });
      dispatch({ type: 'SUCCESS' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      dispatch({ type: 'FAILURE', message: err instanceof ApiError ? err.message : GENERIC_ERROR });
    }
  }, [form, trimmed, storageKey, pageCount, fields, router]);

  // While a save is in flight, the outcome isn't known yet — block every
  // dismissal path (X button, Esc, backdrop click) so the sender can't leave
  // the request's result unobserved or trigger a duplicate submit on reopen.
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (shouldBlockOpenChange(status, nextOpen)) return;
      onOpenChange(nextOpen);
    },
    [status, onOpenChange],
  );

  const inputId = 'save-template-name';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                onClick={() => handleSuccessChoice('continue-sending')}
              >
                {COPY.continueSending}
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
              void handleSave();
            }}
          >
            <DialogHeader>
              <DialogTitle>{COPY.title}</DialogTitle>
              <DialogDescription>{COPY.description}</DialogDescription>
            </DialogHeader>

            <Field label={COPY.nameLabel} htmlFor={inputId} hint={COPY.nameHint}>
              <Input
                id={inputId}
                value={name}
                onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
                placeholder={COPY.namePlaceholder}
                maxLength={80}
                autoFocus
                disabled={isNameInputDisabled(form)}
              />
            </Field>

            {status === 'error' && error ? (
              <p
                role="alert"
                className="mt-md rounded-md border border-danger/30 bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
              >
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleOpenChange(false)}
                disabled={isCancelDisabled(form)}
              >
                {COPY.cancel}
              </Button>
              <Button type="submit" disabled={isSaveDisabled(form)} isLoading={status === 'saving'}>
                {status === 'saving'
                  ? COPY.saving
                  : status === 'error'
                    ? COPY.retry
                    : COPY.save}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
