'use client';

/**
 * Wizard step — share link ("링크 공유").
 *
 * Terminal step of the 'link' delivery branch: generate a shareable contract
 * link (validity window, optional password) and copy it. Like the review step,
 * it owns its own CTA, so the shell hides its footer "다음" here.
 *
 * The link path skips the recipients step, so the placed fields carry no
 * recipient assignment. We persist them first (`saveFields`) — they land with
 * `signRequestId: null` — and then create the link, which binds every unbound
 * field to itself (`createLink`). That ordering is the whole reason the create
 * action runs `saveFields` before `createShareLink`.
 *
 * The settings/generate/result body is the same `ShareLinkBody` the detail
 * screen's modal uses, so the two link-sharing entry points stay in lockstep.
 * This step adds only the wizard framing: a header and, once the link exists, a
 * "대시보드로 가기" hand-off — mirroring the review step's success tone, but kept
 * inline so the just-made link stays visible to copy.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@repo/ui';
import { getToken } from '@/lib/auth';
import { saveFields } from '@/lib/send';
import { SHARE_COPY } from '@/lib/sharing';
import { ShareLinkBody } from '@/components/contracts/share-link-body';
import { useWizard } from './wizard-context';

const COPY = SHARE_COPY.wizard;

export function LinkShareStep() {
  const router = useRouter();
  const { state } = useWizard();
  const { document, fields } = state;

  const goToDashboard = React.useCallback(() => router.push('/dashboard'), [router]);

  // Persist the wizard's in-memory fields before the link is created so
  // `createLink` can bind them (they save with signRequestId: null). Runs inside
  // the body's create action, right before createShareLink.
  const persistFields = React.useCallback(async () => {
    if (!document) return;
    await saveFields(document.id, fields, getToken() ?? undefined);
  }, [document, fields]);

  // The step is only reachable after upload (document set) + fields placed, so
  // this guard is defensive; render nothing rather than a half-formed body.
  if (!document) return null;

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">{COPY.title}</h2>
        <p className="text-sm text-foreground-subtle">{COPY.intro}</p>
      </header>

      <ShareLinkBody
        documentId={document.id}
        beforeCreate={persistFields}
        resultFooter={
          <div className="flex flex-col gap-sm">
            <p className="text-sm font-medium text-success">{COPY.done}</p>
            <Button size="lg" onClick={goToDashboard} className="w-full">
              {COPY.toDashboard}
            </Button>
          </div>
        }
      />
    </div>
  );
}
