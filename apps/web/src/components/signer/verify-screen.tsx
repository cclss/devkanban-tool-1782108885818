'use client';

/**
 * VerifyScreen — the branded identity-check landing.
 *
 * Sender branding header (brand color + font applied via `brandScope`), the document
 * title, and the segmented 6-digit code entry. Entering all six digits
 * auto-submits (Toss "one decision per screen" feel); a button is kept as an
 * explicit/accessible fallback. A wrong or expired code shakes the cells, wipes
 * them, and surfaces the server's Toss-tone message — no blame, just retry.
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { brandScope } from '@/lib/branding';
import { SIGNER_COPY, type SigningMeta } from '@/lib/signing';
import { useSigner } from './signer-context';
import { BrandingHeader } from './branding-header';
import { OtpInput } from './otp-input';

const CODE_LENGTH = 6;

export function VerifyScreen({ meta }: { meta: SigningMeta }) {
  const { verify } = useSigner();

  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shakeNonce, setShakeNonce] = React.useState(0);

  const submit = React.useCallback(
    async (value: string) => {
      if (submitting || value.length !== CODE_LENGTH) return;
      setSubmitting(true);
      setError(null);
      try {
        await verify(value);
        // Success: the provider advances to `viewing` and this screen unmounts.
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
        );
        setCode('');
        setShakeNonce((n) => n + 1);
        setSubmitting(false);
      }
    },
    [submitting, verify],
  );

  return (
    <main
      style={brandScope(meta.sender)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="motion-stagger mt-2xl flex flex-1 flex-col">
        <h1 className="text-2xl font-bold text-foreground">{SIGNER_COPY.verifyTitle}</h1>
        <p className="mt-2xs text-base text-foreground-subtle">{SIGNER_COPY.verifyHint}</p>

        <p className="mt-lg truncate rounded-md bg-surface-muted px-md py-sm text-sm font-medium text-foreground-muted">
          {meta.documentTitle}
        </p>

        <div className="mt-xl flex flex-col gap-xs">
          <OtpInput
            value={code}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            onComplete={submit}
            disabled={submitting}
            invalid={Boolean(error)}
            shakeNonce={shakeNonce}
            autoFocus
            aria-label={SIGNER_COPY.codeLabel}
          />
          <p
            role="alert"
            aria-live="assertive"
            className="min-h-[1.25rem] text-sm text-danger"
          >
            {error}
          </p>
        </div>

        <Button
          size="lg"
          fullWidth
          className="mt-auto"
          disabled={code.length !== CODE_LENGTH}
          isLoading={submitting}
          onClick={() => submit(code)}
        >
          {submitting ? '확인 중' : '본인확인'}
        </Button>
      </div>
    </main>
  );
}
