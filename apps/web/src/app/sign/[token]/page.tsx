'use client';

/**
 * `/sign/[token]` — the signer's mobile-first entry point.
 *
 * A signing link carries the SignRequest access token. This route mounts the
 * shared signer context (state machine + typed API client) for that token and
 * renders whichever screen the current phase calls for. All chrome and layout
 * live inside the flow's screens — this page is just the token → provider wire.
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import { SignerProvider } from '@/components/signer/signer-context';
import { SignerFlow } from '@/components/signer/signer-flow';

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) return null;

  return (
    <SignerProvider token={token}>
      <SignerFlow />
    </SignerProvider>
  );
}
