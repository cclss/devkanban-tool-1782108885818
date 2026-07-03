'use client';

/**
 * ShareLinkPasswordEditor — the inline "비밀번호 확인·수정" panel for one share
 * link row (design-spec conventions/share-link-password-admin.md, grain-3).
 *
 * Opened from a link row's 비밀번호 확인/설정 trigger. On mount it fetches the
 * link's current password state (grain-2 owner-only API) and reflects one of the
 * three semantic states:
 *   • no password        → empty field, "설정된 비밀번호가 없어요…" hint.
 *   • confirmable        → field pre-filled with the plaintext (masked; the
 *                          shared PasswordInput's reveal toggle shows it on demand).
 *   • legacy (unrecoverable) → empty field, "이전에 설정한 비밀번호는 확인할 수
 *                          없어요…" hint — set a new one to make it confirmable again.
 *
 * The same field serves 확인 and 수정: the owner sees the current value (masked),
 * reveals it if they want, edits it, and saves — taking effect immediately (the
 * next unlock reads the fresh value). 저장 replaces the password; 비밀번호 해제
 * removes protection entirely. On success `onChanged` hands the updated link view
 * back to the section so the row's 비밀번호 tag stays in sync.
 *
 * Security: the plaintext lives only in this component's local state while the
 * panel is open. It is dropped on close/remove and never persisted or logged; the
 * server returns only `requiresPassword` on the link view.
 */

import * as React from 'react';
import { Button, Field } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { PasswordInput } from '@/components/password-input';
import {
  getShareLinkPassword,
  passwordEditorInitialValue,
  passwordStateHint,
  SHARE_COPY,
  SHARE_PASSWORD_MIN_LENGTH,
  updateShareLinkPassword,
  type ShareLink,
  type ShareLinkPasswordView,
} from '@/lib/sharing';

const COPY = SHARE_COPY.passwordAdmin;

type Feedback = { tone: 'success' | 'error'; text: string } | null;
type Busy = 'save' | 'remove' | null;

export interface ShareLinkPasswordEditorProps {
  documentId: string;
  link: ShareLink;
  /** Element id of this panel (for the trigger's aria-controls). */
  id: string;
  /** Called with the server's updated link view after a save/remove. */
  onChanged: (updated: ShareLink) => void;
}

export function ShareLinkPasswordEditor({
  documentId,
  link,
  id,
  onChanged,
}: ShareLinkPasswordEditorProps) {
  const [view, setView] = React.useState<ShareLinkPasswordView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [value, setValue] = React.useState('');
  const [initial, setInitial] = React.useState('');
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [feedback, setFeedback] = React.useState<Feedback>(null);

  const fieldId = `${id}-input`;

  // Fetch the current password state once when the panel opens.
  React.useEffect(() => {
    let active = true;
    setLoadError(null);
    getShareLinkPassword(documentId, link.id)
      .then((next) => {
        if (!active) return;
        const start = passwordEditorInitialValue(next);
        setView(next);
        setValue(start);
        setInitial(start);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof ApiError ? err.message : COPY.loadError);
      });
    return () => {
      active = false;
    };
  }, [documentId, link.id]);

  const trimmed = value.trim();
  // Save is meaningful only for a non-empty value that differs from what loaded
  // (re-saving the same confirmable value would be a no-op). Removal is a
  // separate, explicit action so an accidental empty save can't drop protection.
  const canSave = busy === null && trimmed.length > 0 && value !== initial;
  // Show 해제 whenever a password is currently set (disabled while any op runs),
  // plus during its own removal so the button doesn't vanish mid-request.
  const showRemove = Boolean(view?.hasPassword) || busy === 'remove';

  const save = React.useCallback(async () => {
    if (trimmed.length < SHARE_PASSWORD_MIN_LENGTH) {
      setPwError(COPY.tooShort);
      return;
    }
    setPwError(null);
    setFeedback(null);
    setBusy('save');
    const wasSet = Boolean(view?.hasPassword);
    try {
      const updated = await updateShareLinkPassword(documentId, link.id, trimmed);
      // Reflect the just-saved value as the new confirmable baseline.
      setView({ hasPassword: true, recoverable: true, password: trimmed });
      setInitial(trimmed);
      setFeedback({ tone: 'success', text: wasSet ? COPY.savedChanged : COPY.savedSet });
      onChanged(updated);
    } catch (err) {
      setFeedback({
        tone: 'error',
        text: err instanceof ApiError ? err.message : COPY.saveError,
      });
    } finally {
      setBusy(null);
    }
  }, [documentId, link.id, onChanged, trimmed, view]);

  const remove = React.useCallback(async () => {
    setPwError(null);
    setFeedback(null);
    setBusy('remove');
    try {
      const updated = await updateShareLinkPassword(documentId, link.id, null);
      setView({ hasPassword: false, recoverable: false, password: null });
      setValue('');
      setInitial('');
      setFeedback({ tone: 'success', text: COPY.savedRemoved });
      onChanged(updated);
    } catch (err) {
      setFeedback({
        tone: 'error',
        text: err instanceof ApiError ? err.message : COPY.saveError,
      });
    } finally {
      setBusy(null);
    }
  }, [documentId, link.id, onChanged]);

  return (
    <div id={id} className="flex flex-col gap-sm rounded-md border border-border bg-surface-muted p-md">
      {loadError ? (
        <p className="text-sm text-danger" role="alert">
          {loadError}
        </p>
      ) : view === null ? (
        <p className="text-sm text-foreground-subtle" role="status">
          {COPY.loading}
        </p>
      ) : (
        <>
          <Field
            htmlFor={fieldId}
            label={COPY.label}
            hint={passwordStateHint(view)}
            error={pwError ?? undefined}
          >
            <PasswordInput
              id={fieldId}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (pwError) setPwError(null);
                if (feedback) setFeedback(null);
              }}
              placeholder={COPY.placeholder}
              autoComplete="off"
              invalid={Boolean(pwError)}
              disabled={busy !== null}
              aria-describedby={`${fieldId}-message`}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-xs">
            <Button
              type="button"
              size="sm"
              onClick={() => void save()}
              isLoading={busy === 'save'}
              disabled={!canSave}
            >
              {busy === 'save' ? COPY.saving : COPY.save}
            </Button>
            {showRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void remove()}
                isLoading={busy === 'remove'}
                disabled={busy !== null}
                className="text-danger hover:bg-danger-subtle"
              >
                {busy === 'remove' ? COPY.removing : COPY.remove}
              </Button>
            ) : null}
          </div>
        </>
      )}

      {/* Save/remove outcome announced to assistive tech. */}
      <div role="status" aria-live="polite" className="min-h-4">
        {feedback ? (
          <span
            className={
              feedback.tone === 'success'
                ? 'text-xs font-semibold text-success'
                : 'text-xs text-danger'
            }
            role={feedback.tone === 'error' ? 'alert' : undefined}
          >
            {feedback.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
