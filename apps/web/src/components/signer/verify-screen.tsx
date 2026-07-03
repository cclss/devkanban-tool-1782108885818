'use client';

/**
 * VerifyScreen — the branded identity-check landing.
 *
 * A light, friendly entry: a masked-recipient welcome, the document title, and
 * the segmented 6-digit code entry. Entering all six digits auto-submits (Toss
 * "one decision per screen" feel) and dismisses the keyboard; an inline
 * "확인 중이에요" beat gives feedback while the code is checked. The 본인확인
 * button lives in a sticky bottom bar as an explicit/accessible fallback (kept
 * always-reachable, out of the input flow to soften the auto-submit overlap).
 * A wrong or expired code shakes the cells, wipes them, refocuses for retry, and
 * surfaces the server's Toss-tone message — no blame, just retry.
 *
 * Copy is single-sourced in `SIGNER_COPY` (see `@/lib/signing`); the bottom-bar
 * treatment mirrors the signer document-viewer / wizard footer conventions.
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { brandStyle } from '@/lib/branding';
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
        // The server's Toss-tone message wins when present; otherwise fall back
        // to the single-sourced client copy (same value/tone — no regression).
        setError(err instanceof ApiError ? err.message : SIGNER_COPY.verifyError);
        setCode('');
        setShakeNonce((n) => n + 1);
        setSubmitting(false);
      }
    },
    [submitting, verify],
  );

  const greeting = meta.recipientNameMasked
    ? SIGNER_COPY.verifyGreeting(meta.recipientNameMasked)
    : SIGNER_COPY.verifyGreetingFallback;

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="motion-stagger mt-2xl flex flex-1 flex-col pb-2xl">
        <p className="text-base text-foreground-subtle">{greeting}</p>
        <h1 className="mt-2xs text-2xl font-bold text-foreground">{SIGNER_COPY.verifyTitle}</h1>
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
          {/* Auto-submit affordance, swapped for the inline "checking" beat while
              the code is verified (polite so it never interrupts the error alert). */}
          <p aria-live="polite" className="text-sm text-foreground-subtle">
            {submitting ? SIGNER_COPY.verifySubmitting : SIGNER_COPY.verifyAutoSubmitHint}
          </p>
        </div>
      </div>

      {/* Explicit/accessible fallback CTA — auto-submit is the primary path. Kept
          in a sticky bottom bar (wizard-footer / document-viewer convention) so it
          stays reachable and reads as persistent chrome, not a duplicate action. */}
      <div
        className="sticky bottom-0 z-20 -mx-lg border-t border-border bg-surface/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="px-lg py-md">
          <Button
            size="lg"
            fullWidth
            disabled={code.length !== CODE_LENGTH}
            isLoading={submitting}
            onClick={() => submit(code)}
          >
            {submitting ? SIGNER_COPY.verifySubmitting : SIGNER_COPY.verifyCta}
          </Button>
        </div>
      </div>
    </main>
  );
}
