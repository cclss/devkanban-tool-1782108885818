'use client';

/**
 * BrandingHeader — the sender's identity atop the signer screens.
 *
 * Shows the sender's logo (when set) or a primary-tinted monogram fallback, the
 * sender name, and a quiet "보낸 계약" caption. The brand color + font are applied
 * by the caller via `brandScope()` on a wrapping element, so the monogram and any
 * primary accents here re-skin automatically through the `--brand-*` hook.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import type { SignerSender } from '@/lib/signing';

export function BrandingHeader({
  sender,
  className,
}: {
  sender: SignerSender;
  className?: string;
}) {
  const name = sender.name?.trim() || '발신자';
  const monogram = name.charAt(0);

  return (
    <div className={cn('flex items-center gap-sm', className)}>
      {sender.brandLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote sender logo, arbitrary host
        <img
          src={sender.brandLogoUrl}
          alt={`${name} 로고`}
          className="h-10 w-10 rounded-md object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-subtle text-md font-bold text-primary"
        >
          {monogram}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-base font-bold text-foreground">{name}</span>
        <span className="text-xs text-foreground-subtle">님이 보낸 계약</span>
      </div>
    </div>
  );
}
