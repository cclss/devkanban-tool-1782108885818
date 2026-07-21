'use client';

/**
 * HighlightSummary — the pre-read "핵심 조항 요약" card deck (contract-highlight).
 *
 * After the signer clears the access gate, this renders 3–5 plain-language
 * cards (parties / money / term / obligation / caution) *above* the full
 * document, so what matters is grasped without scrolling the whole PDF (the
 * Toss-style 약관 요약 experience). Each card's copy is authored by the server
 * (tone/clause-translation.md); this component owns only the visual card and its
 * chrome — the section heading, the category badge, and the "원문 보기" jump.
 *
 * A `caution` clause (penalty / liability / auto-renewal…) renders in the
 * component's caution Variant — a distinct `warning`-toned surface + a warning
 * glyph — so a risky clause is impossible to skim past. Every visual value comes
 * from the design tokens (contract-highlight's recorded Token Group combination);
 * nothing here is hardcoded and no framer-motion is used (CSS `.motion-stagger`
 * only).
 *
 * Rendered inside the shared document viewer's scroll column so the "원문 보기"
 * link can scroll to the source PDF page in the same container. Absent on flows
 * that don't project `highlights` (the link-share recipient).
 */

import * as React from 'react';
import { cn } from '@repo/ui';
import type { ContractHighlight } from '@/lib/signing';
import type { FillHighlights } from './fill-context';

export interface HighlightSummaryProps {
  /** The projected summary bundle (data + client chrome). */
  highlights: FillHighlights;
  /** Scroll the source PDF page into view (1-based). */
  onJumpToSource: (page: number) => void;
}

export function HighlightSummary({ highlights, onJumpToSource }: HighlightSummaryProps) {
  const { available, clauses, copy } = highlights;

  // Nothing surfaced (scanned/image PDF, or none detected): a calm one-liner
  // pointing at the document below — never an error, never a jarring empty card.
  if (!available || clauses.length === 0) {
    return (
      <section aria-label={copy.sectionTitle} className="rounded-lg border border-border bg-surface-muted px-lg py-md">
        <p className="text-sm text-foreground-subtle">{copy.unavailable}</p>
      </section>
    );
  }

  return (
    <section aria-label={copy.sectionTitle}>
      <h2 className="text-lg font-bold text-foreground">{copy.sectionTitle}</h2>
      <p className="mt-2xs text-sm text-foreground-subtle">{copy.sectionHint}</p>

      <ul className="motion-stagger mt-md flex list-none flex-col gap-sm p-0">
        {clauses.map((clause) => (
          <li key={clause.id}>
            <HighlightCard
              clause={clause}
              categoryLabel={copy.categoryLabel[clause.category]}
              sourceLinkLabel={copy.sourceLink}
              onJumpToSource={onJumpToSource}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface HighlightCardProps {
  clause: ContractHighlight;
  categoryLabel: string;
  sourceLinkLabel: string;
  onJumpToSource: (page: number) => void;
}

/** One key-clause card. `caution` tone swaps to the warning-toned Variant. */
function HighlightCard({
  clause,
  categoryLabel,
  sourceLinkLabel,
  onJumpToSource,
}: HighlightCardProps) {
  const caution = clause.tone === 'caution';
  // A 0/unknown source page has nowhere to jump to; omit the link then.
  const hasSource = clause.source.page >= 1;

  return (
    <article
      className={cn(
        'rounded-lg border p-lg',
        caution
          ? 'border-warning bg-warning-subtle'
          : 'border-border bg-surface shadow-sm',
      )}
    >
      <div className="flex items-center gap-xs">
        {caution ? <CautionGlyph /> : null}
        <span
          className={cn(
            'inline-flex items-center rounded-sm px-xs py-2xs text-2xs font-bold',
            caution
              ? 'bg-warning text-warning-foreground'
              : 'bg-surface-muted text-foreground-subtle',
          )}
        >
          {categoryLabel}
        </span>
      </div>

      <h3 className="mt-sm text-base font-bold text-foreground">{clause.title}</h3>
      <p className="mt-2xs text-sm leading-relaxed text-foreground-muted">{clause.summary}</p>

      {hasSource ? (
        <button
          type="button"
          onClick={() => onJumpToSource(clause.source.page)}
          className={cn(
            'mt-sm inline-flex items-center gap-2xs rounded-sm text-sm font-semibold text-primary',
            'transition-colors duration-fast ease-standard hover:underline',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          )}
        >
          {sourceLinkLabel}
          <span className="text-xs font-normal text-foreground-subtle">
            {clause.source.page}페이지
          </span>
          <ArrowGlyph />
        </button>
      ) : null}
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

/** Small chevron hinting the source-jump direction (decorative). */
function ArrowGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
