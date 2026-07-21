'use client';

/**
 * CompletionSummary — the "계약 핵심 요약" recap on the finish screen
 * (contract-highlight `recap` Extension).
 *
 * After signing, this resurfaces the same key-clause cards the signer saw in the
 * pre-read summary (grain-6) so they leave with the contract's essentials in
 * mind. It reuses contract-highlight's card look verbatim (surface/border card,
 * caution → warning-toned Variant, category badge) — with one structural change:
 * the "원문 보기" source-jump is removed, because the completion screen is a
 * portal takeover with no document viewer to scroll. Padding is the compact `md`
 * (not the pre-read `lg`) to fit the narrow celebratory column.
 *
 * The card *content* (title/summary) is server-authored (tone/clause-translation.md);
 * this owns only the visual chrome. Every value comes from the design tokens; no
 * framer-motion (the finish column's `.motion-stagger` carries the entrance).
 *
 * Renders nothing when there are no clauses to recap (share flow, scanned PDF,
 * or none detected) — the caller gates on that, and this guards defensively too.
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import type { ContractHighlight } from '@/lib/signing';
import { selectCompletionSummary } from '@/lib/completion-summary';
import type { FillHighlightsCopy } from './fill-context';

export interface CompletionSummaryProps {
  /** Server-authored key-clause cards (from the pre-read highlights bundle). */
  clauses: ContractHighlight[];
  /** Client-owned chrome (section heading + category badge labels). */
  copy: FillHighlightsCopy;
  /** Section heading for the recap (finish-screen voice, e.g. "계약 핵심 요약"). */
  heading: string;
}

export function CompletionSummary({ clauses, copy, heading }: CompletionSummaryProps) {
  const recap = selectCompletionSummary(clauses);
  if (recap.length === 0) return null;

  return (
    <section aria-label={heading} className="w-full text-left">
      <h2 className="text-2xs font-medium text-foreground-subtle">{heading}</h2>
      <ul className="mt-xs flex list-none flex-col gap-sm p-0">
        {recap.map((clause) => (
          <li key={clause.id}>
            <RecapCard clause={clause} categoryLabel={copy.categoryLabel[clause.category]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RecapCardProps {
  clause: ContractHighlight;
  categoryLabel: string;
}

/**
 * One recap card — contract-highlight's card without the source-jump affordance.
 * `caution` tone swaps to the warning-toned Variant so a risky clause stays
 * visually distinct even in the recap.
 */
function RecapCard({ clause, categoryLabel }: RecapCardProps) {
  const caution = clause.tone === 'caution';

  return (
    <article
      className={cn(
        'rounded-lg border p-md',
        caution ? 'border-warning bg-warning-subtle' : 'border-border bg-surface shadow-sm',
      )}
    >
      <div className="flex items-center gap-xs">
        {caution ? <CautionGlyph /> : null}
        <span
          className={cn(
            'inline-flex items-center rounded-sm px-xs py-2xs text-2xs font-bold',
            caution ? 'bg-warning text-warning-foreground' : 'bg-surface-muted text-foreground-subtle',
          )}
        >
          {categoryLabel}
        </span>
      </div>

      <h3 className="mt-xs text-sm font-bold text-foreground">{clause.title}</h3>
      <p className="mt-2xs text-sm leading-relaxed text-foreground-muted">{clause.summary}</p>
    </article>
  );
}

/** Warning triangle marking a caution clause (warning-toned, decorative). */
function CautionGlyph() {
  return (
    <span aria-hidden="true" className="text-warning">
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <path
          d="M12 4.5l8.5 14.5H3.5L12 4.5z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
      </svg>
    </span>
  );
}
