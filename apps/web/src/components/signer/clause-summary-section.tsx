'use client';

/**
 * ClauseSummarySection — the "핵심을 먼저, 원문은 필요할 때" reading surface that
 * sits *above* the original document viewer on the sign/share entry screens.
 *
 * It assembles three pieces (see design-spec/components/clause-summary-section):
 *   1. a one-liner banner (the whole contract in one sentence + the AI mark),
 *   2. a stack of clause cards (the 3–5 key clauses, most-important first), and
 *   3. an AI disclaimer at the bottom (the boundary into the original).
 *
 * The AI framing lives in the section chrome (banner + disclaimer) — the clause
 * cards themselves stay content-toned (neutral / warning), so the AI mark is not
 * repeated on every card (avoids visual noise and a caution↔AI tone clash).
 *
 * Fallback: this component is only mounted when a summary exists. `DocumentViewer`
 * renders it solely when `useFill().clauseSummary` is non-null; a `null` summary
 * means the section never appears and the plain original viewer shows on its own
 * (design-spec/vocabulary/clause-summary.md — graceful degradation). It never
 * fabricates an empty state.
 *
 * Both flows (OTP `/sign/[token]`, link-share `/share/[token]`) reuse this one
 * section verbatim through the `useFill` adapter.
 */

import * as React from 'react';
import type { ClauseSummary, ClauseSummaryClause } from '@repo/db';
import { Card, cn } from '@repo/ui';
import { CLAUSE_CARD_COPY } from '@/lib/clause-card-copy';
import { splitKeyNumbers, clauseTone } from '@/lib/clause-summary';

export interface ClauseSummarySectionProps {
  /** The AI key-clause summary to render (callers pass this only when non-null). */
  summary: ClauseSummary;
  /**
   * Opens the collapsed original and scrolls to a clause's `sourcePage`. Passed
   * down by `DocumentViewer`; a clause card's "원문에서 보기" anchor calls it. When
   * omitted (or a clause has no in-range `sourcePage`) the anchor is not rendered.
   */
  onViewSource?: (page: number) => void;
  /**
   * Page count of the loaded original. Used to gate the "원문에서 보기" anchor to a
   * real page: a clause's `sourcePage` must be within `[1, pageCount]` or the
   * anchor is not rendered (a link to a non-existent page would be a dead jump).
   * `0` while the PDF is still loading, so anchors appear once the range is known.
   */
  pageCount?: number;
}

/** The summary-first section: one-liner banner → clause cards → disclaimer. */
export function ClauseSummarySection({
  summary,
  onViewSource,
  pageCount = 0,
}: ClauseSummarySectionProps) {
  return (
    <section aria-label="핵심 조항 요약" className="mt-lg flex flex-col gap-md">
      <OneLinerBanner oneLiner={summary.oneLiner} />

      <ul className="flex flex-col gap-sm">
        {summary.clauses.map((clause, index) => (
          <li key={index}>
            <ClauseCard clause={clause} pageCount={pageCount} onViewSource={onViewSource} />
          </li>
        ))}
      </ul>

      {/* The disclaimer is UI chrome (not summary data): a calm, bottom-placed
          notice at the summary→original boundary. A hairline top rule seals the
          summary block and sets this as its closing line before the original
          toggle ("요약은 AI, 원문이 정본"). Reads clearly at that boundary —
          `foreground-muted` on the page ground clears WCAG AA (≈6.5:1, vs the
          old `foreground-subtle` ≈4.2:1 which failed), and an info glyph gives a
          non-color shape signal (the notice never rides on color alone). Kept
          calm (normal weight, no tint) so it doesn't compete with the ai-accent
          banner above or the clause cards' own tone. */}
      <p className="flex items-start gap-2xs border-t border-border px-2xs pt-sm text-sm leading-relaxed text-foreground-muted">
        <InfoIcon />
        <span>{CLAUSE_CARD_COPY.disclaimer}</span>
      </p>
    </section>
  );
}

/**
 * The '한 줄 요지' banner — the whole contract in one line, and the one place the
 * AI framing is signaled for the section (ai-accent subtle tint + sparkle + label).
 */
function OneLinerBanner({ oneLiner }: { oneLiner: string }) {
  return (
    <div className="flex w-full items-start gap-xs rounded-md bg-ai-accent-subtle px-md py-sm">
      <SparkleIcon />
      <div className="min-w-0">
        <p className="text-2xs font-bold uppercase tracking-wide text-ai-accent-strong">
          {CLAUSE_CARD_COPY.aiMarkLabel}
        </p>
        <p className="mt-2xs text-md font-semibold leading-snug text-foreground">{oneLiner}</p>
      </div>
    </div>
  );
}

/** One key clause rendered signer-height: category pill, headline, detail. */
function ClauseCard({
  clause,
  pageCount,
  onViewSource,
}: {
  clause: ClauseSummaryClause;
  pageCount: number;
  onViewSource?: (page: number) => void;
}) {
  const tone = clauseTone(clause.emphasis);
  // Only offer "원문에서 보기" for a clause that points at a real page: require the
  // handle to be wired and `sourcePage` to fall within the loaded original's range
  // ([1, pageCount]). Missing or out-of-range → no anchor (never a dead jump).
  const { sourcePage } = clause;
  const canViewSource =
    onViewSource != null &&
    sourcePage != null &&
    Number.isInteger(sourcePage) &&
    sourcePage >= 1 &&
    sourcePage <= pageCount;

  return (
    <Card className={cn('flex flex-col gap-xs p-lg', tone.surfaceClassName, tone.borderClassName)}>
      <div className="flex flex-wrap items-center gap-2xs">
        <CategoryPill category={clause.category} />
        {tone.caution ? <CautionMark /> : null}
      </div>

      <h3 className="text-md font-semibold leading-snug text-foreground">
        <HighlightedText text={clause.headline} />
      </h3>
      <p className="text-sm leading-relaxed text-foreground-muted">
        <HighlightedText text={clause.detail} />
      </p>

      {onViewSource && canViewSource ? (
        <SourceAnchor page={sourcePage} onClick={() => onViewSource(sourcePage)} />
      ) : null}
    </Card>
  );
}

/**
 * The "원문에서 보기" anchor: a quiet, actionable link at the bottom of a clause card
 * that opens the collapsed original and scrolls to the clause's source page. Styled
 * in the established "actionable = primary" link language (primary + underline), kept
 * calm inside the card's content tone (self-start, not a loud button). The visible
 * label carries the action and the underline is a non-color affordance; the accessible
 * label names the page so the jump's destination is spoken (color is never the sole
 * signal — clause-card Base "색 단독 아님").
 */
function SourceAnchor({ page, onClick }: { page: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={CLAUSE_CARD_COPY.viewSourceLabel(page)}
      className={cn(
        'mt-2xs inline-flex items-center gap-2xs self-start rounded-sm text-sm font-semibold text-primary',
        'underline underline-offset-2 transition-colors duration-fast ease-standard hover:text-primary-hover',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
      )}
    >
      {CLAUSE_CARD_COPY.viewSource}
      <ArrowIcon />
    </button>
  );
}

/** Small forward arrow marking the jump into the original (decorative; `aria-hidden`). */
function ArrowIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/**
 * The neutral category pill at the top of a clause card — a grouping label, not
 * a status, so it stays neutral (no emphasis hue; the category is a classifying
 * tag, not the clause's content). Exported so the completion recap renders the
 * exact same pill and both surfaces read as one clause-card visual family.
 */
export function CategoryPill({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted px-xs py-2xs text-2xs font-semibold text-foreground-subtle">
      {category}
    </span>
  );
}

/**
 * Render a sentence with its key numbers in bold, keeping the sentence flowing.
 * Emphasis is weight-only — the text stays `foreground`, no hue (avoids
 * color-alone signaling and tinted-background AA issues). Exported so the
 * completion recap emphasizes key numbers with the same weight-only treatment.
 */
export function HighlightedText({ text }: { text: string }) {
  const segments = splitKeyNumbers(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <strong key={index} className="font-bold text-foreground">
            {segment.text}
          </strong>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/**
 * The caution signal on a `caution` clause: a shape-different warning icon (hue
 * carried here, not on the text) + the "주의" label, so the signal never rides on
 * color alone (mirrors UrgencyBadge's icon-carries-the-hue rule). Exported so the
 * completion recap flags caution clauses with the identical mark + "주의" label.
 */
export function CautionMark() {
  return (
    <span className="inline-flex items-center gap-2xs text-2xs font-semibold text-foreground-muted">
      <svg
        className="h-3 w-3 text-warning"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      {CLAUSE_CARD_COPY.cautionLabel}
    </span>
  );
}

/**
 * Info glyph on the boundary disclaimer — a shape-based non-color signal that
 * marks the line as a notice. Kept in the same `foreground-muted` tone as the
 * text (a shape cue, not a color cue) and `aria-hidden`; the disclaimer text
 * carries the meaning. Deliberately not the AI sparkle — the AI framing is
 * signaled once on the banner above and must not repeat here.
 */
function InfoIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/** Sparkle glyph marking the summary as AI-assisted (decorative; `aria-hidden`). */
function SparkleIcon() {
  return (
    <svg
      className="mt-2xs h-4 w-4 shrink-0 text-ai-accent-strong"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
      <path d="M19 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8L19 14z" opacity="0.7" />
    </svg>
  );
}
