'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { ContractWizard } from '@/components/wizard/contract-wizard';

/**
 * `/contracts/new` — the sender's contract-creation wizard.
 *
 * Routed to from the dashboard's "새 계약 생성" CTA. Unauthenticated visitors are
 * bounced to login before any wizard work, mirroring the dashboard guard.
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

  return <ContractWizard />;
}
