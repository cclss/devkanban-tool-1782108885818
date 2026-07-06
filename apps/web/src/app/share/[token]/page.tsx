'use client';

/**
 * `/share/[token]` — the link-share recipient's mobile-first entry point.
 *
 * A share link carries the LINK SignRequest access token. This route mounts the
 * share context (state machine + typed API client) for that token and renders
 * whichever screen the current phase calls for. All chrome and layout live inside
 * the flow's screens — this page is just the token → provider wire, mirroring the
 * OTP `/sign/[token]` route while staying entirely separate from it.
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import { ShareProvider } from '@/components/share/share-context';
import { ShareFlow } from '@/components/share/share-flow';

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) return null;

  return (
    <ShareProvider token={token}>
      <ShareFlow />
    </ShareProvider>
  );
}
