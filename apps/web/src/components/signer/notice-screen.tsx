'use client';

/**
 * NoticeScreen — friendly terminal for a link that can't be signed.
 *
 * Covers the three non-signable outcomes with a calm, single-message layout
 * (no error chrome, no blame — the Toss voice): an already-signed contract, a
 * no-longer-signable contract, and an invalid link. A small status glyph sets
 * the tone (success tint for "done", neutral for the rest).
 */

import * as React from 'react';
import { SIGNER_COPY, type SigningMeta } from '@/lib/signing';
import type { BlockReason } from './signer-context';
import { BrandingHeader } from './branding-header';
import { brandStyle } from '@/lib/branding';

interface NoticeCopy {
  title: string;
  body: string;
  tone: 'success' | 'neutral';
}

const COPY: Record<BlockReason, NoticeCopy> = {
  alreadySigned: {
    title: SIGNER_COPY.alreadySignedTitle,
    body: SIGNER_COPY.alreadySigned,
    tone: 'success',
  },
  unavailable: {
    title: SIGNER_COPY.unavailableTitle,
    body: SIGNER_COPY.unavailable,
    tone: 'neutral',
  },
  invalidLink: {
    title: SIGNER_COPY.invalidLinkTitle,
    body: SIGNER_COPY.invalidLink,
    tone: 'neutral',
  },
};

export function NoticeScreen({
  reason,
  meta,
}: {
  reason: BlockReason;
  meta: SigningMeta | null;
}) {
  const copy = COPY[reason];

  return (
    <main
      style={brandStyle(meta?.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      {meta ? <BrandingHeader sender={meta.sender} /> : null}

      <div className="motion-stagger flex flex-1 flex-col items-center justify-center text-center">
        <Glyph tone={copy.tone} />
        <h1 className="mt-lg text-2xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-xs text-base text-foreground-subtle">{copy.body}</p>
      </div>
    </main>
  );
}

function Glyph({ tone }: { tone: NoticeCopy['tone'] }) {
  if (tone === 'success') {
    return (
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-success-subtle text-success"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-foreground-subtle"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
        <path
          d="M12 8v5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="12" cy="16.5" r="1.4" fill="currentColor" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}
