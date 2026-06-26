'use client';

/**
 * ShareLinksSection — the contract detail screen's share-link area.
 *
 * Two parts (design-spec components/contract-detail):
 *   1. The '링크로 공유' primary action — the entry point that opens the
 *      ShareLinkDialog (grain-5 fills the modal's settings + generation).
 *   2. The link list slot — a summary of the contract's existing share links
 *      (유효기간 남음 · 만료 · 중지). grain-4 only places the slot with its empty
 *      state; grain-5 fetches via `lib/sharing.ts` and renders the rows.
 */

import * as React from 'react';
import { Button } from '@repo/ui';
import { CONTRACT_DETAIL_COPY } from '@/lib/contract-detail';
import { ShareLinkDialog } from './share-link-dialog';

const COPY = CONTRACT_DETAIL_COPY.share;

export interface ShareLinksSectionProps {
  documentId: string;
  documentTitle: string;
}

export function ShareLinksSection({ documentId, documentTitle }: ShareLinksSectionProps) {
  const [shareOpen, setShareOpen] = React.useState(false);

  return (
    <section aria-labelledby="share-links-heading" className="flex flex-col gap-md">
      <div className="flex flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2xs">
          <h2 id="share-links-heading" className="text-lg font-bold text-foreground">
            {COPY.sectionTitle}
          </h2>
          <p className="text-sm text-foreground-subtle">{COPY.sectionHelp}</p>
        </div>
        <Button
          size="lg"
          onClick={() => setShareOpen(true)}
          className="shrink-0 sm:w-auto"
        >
          <ShareIcon />
          {COPY.createButton}
        </Button>
      </div>

      {/*
        Link list slot. grain-5 replaces this empty state with the live list of
        share links (state pills: 사용 중 / 만료됨 / 중지됨 / 제출 완료) fetched via
        lib/sharing.ts. Until then the detail screen shows the "no links yet" rest
        state so the section reads as intentional rather than missing.
      */}
      <EmptyLinks />

      <ShareLinkDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        documentId={documentId}
        documentTitle={documentTitle}
      />
    </section>
  );
}

function EmptyLinks() {
  return (
    <div className="flex flex-col items-center gap-2xs rounded-md border border-dashed border-border bg-surface-muted px-lg py-2xl text-center">
      <LinkGlyph />
      <p className="mt-xs text-base font-semibold text-foreground">{COPY.emptyTitle}</p>
      <p className="text-sm text-foreground-subtle">{COPY.emptyBody}</p>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-subtle text-primary"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
