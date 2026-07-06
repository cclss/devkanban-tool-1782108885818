'use client';

/**
 * NoticeScreen — friendly terminal for a link that can't be opened/filled.
 *
 * A calm, single-message layout (no error chrome, no blame — the Toss voice):
 * a status glyph sets the tone (success tint for a "done" outcome, neutral for
 * the rest), then a title + one guiding sentence. Purely presentational: each
 * flow computes the copy + tone for its own terminal reasons (the OTP signer's
 * already-signed / unavailable / invalid-link; the share recipient's expired /
 * disabled / already-submitted …) and hands them in.
 */

import * as React from 'react';
import type { SignerSender } from '@/lib/signing';
import { BrandingHeader } from './branding-header';
import { brandStyle } from '@/lib/branding';

export type NoticeTone = 'success' | 'neutral';

export interface NoticeScreenProps {
  title: string;
  body: string;
  tone: NoticeTone;
  /** Sender identity for the branding header; omit to drop the header. */
  sender?: SignerSender | null;
  /** Brand color for the `brandStyle()` hook. */
  brandColor?: string | null;
}

export function NoticeScreen({ title, body, tone, sender, brandColor }: NoticeScreenProps) {
  return (
    <main
      style={brandStyle(brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      {sender ? <BrandingHeader sender={sender} /> : null}

      <div className="motion-stagger flex flex-1 flex-col items-center justify-center text-center">
        <Glyph tone={tone} />
        <h1 className="mt-lg text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-xs text-base text-foreground-subtle">{body}</p>
      </div>
    </main>
  );
}

function Glyph({ tone }: { tone: NoticeTone }) {
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
