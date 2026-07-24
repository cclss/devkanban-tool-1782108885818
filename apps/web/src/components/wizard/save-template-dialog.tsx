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
  successClose: '확인',
} as const;

type SaveState = 'idle' | 'saving' | 'success' | 'error';

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
  const [name, setName] = React.useState('');
  const [status, setStatus] = React.useState<SaveState>('idle');
  const [error, setError] = React.useState<string | null>(null);

  // Reset to a clean form whenever the modal (re)opens, so a prior name/error
  // never leaks into the next save.
  React.useEffect(() => {
    if (open) {
      setName('');
      setStatus('idle');
      setError(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && status !== 'saving';

  const handleSave = React.useCallback(async () => {
    if (trimmed.length === 0) return;
    setStatus('saving');
    setError(null);
    try {
      await createTemplate({ name: trimmed, storageKey, pageCount, fields });
      setStatus('success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
      setStatus('error');
    }
  }, [trimmed, storageKey, pageCount, fields, router]);

  const inputId = 'save-template-name';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {status === 'success' ? (
          <div className="flex flex-col items-center gap-md py-sm text-center">
            <SuccessCheck size={72} aria-label={COPY.successTitle} />
            <DialogHeader className="items-center pb-0">
              <DialogTitle>{COPY.successTitle}</DialogTitle>
              <DialogDescription>{COPY.successBody}</DialogDescription>
            </DialogHeader>
            <Button size="md" fullWidth onClick={() => onOpenChange(false)}>
              {COPY.successClose}
            </Button>
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
                onChange={(e) => setName(e.target.value)}
                placeholder={COPY.namePlaceholder}
                maxLength={80}
                autoFocus
                disabled={status === 'saving'}
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
                onClick={() => onOpenChange(false)}
                disabled={status === 'saving'}
              >
                {COPY.cancel}
              </Button>
              <Button type="submit" disabled={!canSave} isLoading={status === 'saving'}>
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
