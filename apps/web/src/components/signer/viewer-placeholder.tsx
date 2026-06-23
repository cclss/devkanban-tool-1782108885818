'use client';

/**
 * ViewerPlaceholder — the post-verification landing for `viewing`.
 *
 * Grain-2 stops here: identity is confirmed and the signer's payload (fields +
 * PDF path) is loaded into context, ready for the real fit-width PDF viewer,
 * field highlights, and bottom-fixed CTA that later grains render in this slot.
 * Until then we confirm the hand-off so the flow is demonstrably wired.
 */

import * as React from 'react';
import { brandStyle } from '@/lib/branding';
import type { SigningMeta } from '@/lib/signing';
import { useSigner } from './signer-context';
import { BrandingHeader } from './branding-header';

export function ViewerPlaceholder({ meta }: { meta: SigningMeta }) {
  const { state } = useSigner();
  const fieldCount = state.payload?.fields.length ?? 0;

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="motion-stagger mt-2xl flex flex-1 flex-col">
        <span className="inline-flex w-fit items-center gap-2xs rounded-full bg-success-subtle px-sm py-2xs text-xs font-bold text-success">
          본인확인 완료
        </span>
        <h1 className="mt-sm text-2xl font-bold text-foreground">
          {state.payload?.documentTitle ?? meta.documentTitle}
        </h1>
        <p className="mt-2xs text-base text-foreground-subtle">
          서명할 항목 {fieldCount}개를 곧 확인할 수 있어요.
        </p>

        <div className="mt-xl flex flex-1 items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-muted p-xl text-center text-sm text-foreground-subtle">
          문서 화면을 준비하고 있어요.
        </div>
      </div>
    </main>
  );
}
