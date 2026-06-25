'use client';

/**
 * LoadingScreen — the pre-meta skeleton for the signer landing.
 *
 * Mirrors the verify screen's layout (header, title, code cells) with shimmering
 * placeholders so the transition into the real screen doesn't jump. The shimmer
 * freezes flat under reduced-motion (handled globally).
 */

import * as React from 'react';
import { Skeleton } from '@repo/ui';

export function LoadingScreen() {
  return (
    <main
      aria-busy="true"
      aria-label="불러오는 중"
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-2xl pt-xl"
    >
      <div className="flex items-center gap-sm">
        <Skeleton className="h-10 w-10" shape="rect" />
        <div className="flex flex-col gap-2xs">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>

      <div className="mt-2xl flex flex-col gap-sm">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-md h-10 w-full" shape="rect" />
      </div>

      <div className="mt-xl flex justify-between gap-xs">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" shape="rect" />
        ))}
      </div>
    </main>
  );
}
