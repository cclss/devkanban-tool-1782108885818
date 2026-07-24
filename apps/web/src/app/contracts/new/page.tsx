'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { NewContractStart } from '@/components/wizard/new-contract-start';

/**
 * `/contracts/new` — the sender's contract-creation entry point.
 *
 * Routed to from the dashboard's "새 계약 생성" CTA. Unauthenticated visitors are
 * bounced to login before any work, mirroring the dashboard guard. The screen
 * itself is `NewContractStart`, which offers "새로 업로드" (the classic
 * from-scratch wizard) or "내 템플릿에서 시작" (load a saved template straight into
 * the recipients step). A `?template=<id>` query prepares that template on entry,
 * so the picker is wrapped in Suspense (it reads the query via useSearchParams).
 */
export default function NewContractPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <React.Suspense fallback={null}>
      <NewContractStart />
    </React.Suspense>
  );
}
