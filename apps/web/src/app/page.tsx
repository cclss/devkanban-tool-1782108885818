'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BlobBackground } from '@/components/blob-background';
import { isAuthenticated } from '@/lib/auth';

/**
 * Root entry gate (`/`).
 *
 * Decides where a visitor belongs the moment the session is readable on the
 * client: authenticated → `/dashboard`, otherwise → `/login`. `replace` keeps
 * `/` out of history so back-navigation never loops through this gate. The
 * branch reuses the single source of truth in `@/lib/auth` rather than
 * re-deriving auth state here.
 */
export default function HomePage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login');
  }, [router]);

  // A calm, centered splash holds the screen for the brief moment before the
  // redirect, so the visitor never sees a blank flash (FOUC). The decorative
  // backdrop is the same one the auth shell uses; the spinner collapses to a
  // static ring under `prefers-reduced-motion` (handled globally in
  // `globals.css`).
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-md py-2xl">
      <BlobBackground />

      <div role="status" aria-busy="true" className="relative z-10 flex flex-col items-center gap-md">
        <span className="text-sm font-bold tracking-tight text-primary">전자계약</span>
        <Spinner />
        <span className="sr-only">로그인 상태를 확인하고 있어요.</span>
      </div>
    </main>
  );
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
