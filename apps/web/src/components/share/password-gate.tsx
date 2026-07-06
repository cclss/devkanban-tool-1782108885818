'use client';

/**
 * PasswordGate — the recipient's branded access gate (verify-screen/password-gate).
 *
 * The Extension of the signer's verify screen for link sharing: the same branding
 * header, document chip, centered column, full-width submit, and entry motion —
 * but the 6-digit OTP is replaced by a single password input (with the shared
 * show/hide reveal). Unlike the OTP screen there is no auto-submit; the recipient
 * presses 확인 explicitly, and the button is enabled only once the field is
 * non-empty. A wrong/locked password paints the danger token, shakes the field
 * once, and surfaces the server's Toss-tone message — no blame, just retry.
 */

import * as React from 'react';
import { Button, Field, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { brandStyle } from '@/lib/branding';
import { PasswordInput } from '@/components/password-input';
import { BrandingHeader } from '@/components/signer/branding-header';
import { SHARE_RECIPIENT_COPY, type ShareMeta } from '@/lib/share-recipient';
import { useShare } from './share-context';

const COPY = SHARE_RECIPIENT_COPY.gate;
const INPUT_ID = 'share-password';

export function PasswordGate({ meta }: { meta: ShareMeta }) {
  const { unlock } = useShare();

  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shakeNonce, setShakeNonce] = React.useState(0);

  const canSubmit = password.trim().length > 0 && !submitting;

  const submit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (password.trim().length === 0 || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await unlock(password);
        // Success: the provider advances to `viewing` (or a terminal notice) and
        // this screen unmounts.
      } catch (err) {
        setError(err instanceof ApiError ? err.message : COPY.fallbackError);
        setPassword('');
        setShakeNonce((n) => n + 1);
        setSubmitting(false);
      }
    },
    [password, submitting, unlock],
  );

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <form onSubmit={submit} className="motion-stagger mt-2xl flex flex-1 flex-col">
        <h1 className="text-2xl font-bold text-foreground">{COPY.title}</h1>
        <p className="mt-2xs text-base text-foreground-subtle">{COPY.hint}</p>

        <p className="mt-lg truncate rounded-md bg-surface-muted px-md py-sm text-sm font-medium text-foreground-muted">
          {meta.documentTitle}
        </p>

        <div className="mt-xl flex flex-col gap-xs">
          <Field label={COPY.label} htmlFor={INPUT_ID}>
            <div
              // Re-key on the nonce so the shake replays cleanly each failed attempt.
              key={`shake-${shakeNonce}`}
              className={cn(error && 'animate-shake')}
            >
              <PasswordInput
                id={INPUT_ID}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={COPY.placeholder}
                autoComplete="current-password"
                autoFocus
                disabled={submitting}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${INPUT_ID}-error` : undefined}
              />
            </div>
          </Field>
          <p
            id={`${INPUT_ID}-error`}
            role="alert"
            aria-live="assertive"
            className="min-h-[1.25rem] text-sm text-danger"
          >
            {error}
          </p>
        </div>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-auto"
          disabled={!canSubmit}
          isLoading={submitting}
        >
          {submitting ? COPY.submitting : COPY.submit}
        </Button>
      </form>
    </main>
  );
}
