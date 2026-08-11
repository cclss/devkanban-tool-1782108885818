'use client';

/**
 * ClauseCardsScreen — the 핵심 조항 카드 화면 shown right after a successful verify.
 *
 * Before the signer wades through the full PDF, the server-extracted 핵심 조항
 * (1–5 cards) are surfaced here in the Toss "약관 요약" spirit: each card carries
 * the clause title, a plain-language ("일상어") rendering, and any key figures
 * (금액·기간·날짜) as emphasized chips. A 주의 clause is set apart in a warning
 * tone (orange border + tint + badge). Every card offers a "원문 보기" deep-link
 * that drops the signer into the original at that clause's page; a bottom CTA
 * opens the original from the top.
 *
 * This screen only renders when the payload actually carries clauses — the
 * signer state machine routes a 0-card payload straight to the viewer (no error
 * screen), so this component never has to render an empty state.
 */

import * as React from 'react';
import { Button, Card, cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import {
  SIGNER_COPY,
  visibleClauseCards,
  type ClauseFigure,
  type ExtractedClause,
  type SignerSender,
} from '@/lib/signing';
import { useSigner } from './signer-context';
import { BrandingHeader } from './branding-header';

const COPY = SIGNER_COPY.cards;

/** Neutral sender used before meta resolves (the card screen enters after verify,
 * so meta is present in practice — this only satisfies the header's contract). */
const EMPTY_SENDER: SignerSender = { name: null, brandColor: null, brandLogoUrl: null };

export function ClauseCardsScreen() {
  const { state, goViewer } = useSigner();
  const clauses = React.useMemo(
    () => visibleClauseCards(state.payload?.clauses ?? []),
    [state.payload],
  );

  return (
    <main
      style={brandStyle(state.meta?.sender.brandColor ?? null)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pb-[7rem] pt-xl"
    >
      <BrandingHeader sender={state.meta?.sender ?? EMPTY_SENDER} />

      <div className="mt-lg">
        <h1 className="text-2xl font-bold leading-snug text-foreground">{COPY.title}</h1>
        <p className="mt-xs text-base text-foreground-subtle">{COPY.subtitle}</p>
      </div>

      <ul className="motion-stagger mt-xl flex flex-col gap-md">
        {clauses.map((clause, index) => (
          <li key={`${clause.page}-${index}`}>
            <ClauseCard clause={clause} onViewSource={() => goViewer(clause.page)} />
          </li>
        ))}
      </ul>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto w-full max-w-[480px] px-lg py-md">
          <Button fullWidth size="lg" onClick={() => goViewer()}>
            {COPY.viewFull}
          </Button>
        </div>
      </div>
    </main>
  );
}

export interface ClauseCardProps {
  clause: ExtractedClause;
  onViewSource: () => void;
}

/**
 * One clause card. A 주의 clause switches the whole card into the warning tone
 * (orange border + tint) and shows a warning badge, so risk is legible at a
 * glance without reading the body. Presentational (no context) so the design
 * gallery can preview it with fixture clauses.
 */
export function ClauseCard({ clause, onViewSource }: ClauseCardProps) {
  const { caution } = clause;
  return (
    <Card
      className={cn(
        'flex flex-col gap-sm p-lg',
        caution && 'border-warning bg-warning-subtle',
      )}
      // A caution clause is an aside the reader should not miss.
      role={caution ? 'note' : undefined}
      aria-label={caution ? `${COPY.cautionLabel} 조항: ${clause.title}` : undefined}
    >
      <div className="flex items-start justify-between gap-xs">
        <h2 className="text-lg font-bold text-foreground">{clause.title}</h2>
        {caution ? (
          <span className="shrink-0 rounded-full bg-warning px-xs py-2xs text-2xs font-bold text-warning-foreground">
            {COPY.cautionLabel}
          </span>
        ) : null}
      </div>

      <p className="whitespace-pre-line text-base leading-relaxed text-foreground-subtle">
        {clause.plainText}
      </p>

      {clause.figures.length > 0 ? (
        <ul className="flex flex-wrap gap-2xs">
          {clause.figures.map((figure, index) => (
            <li key={`${figure.kind}-${index}`}>
              <FigureChip figure={figure} caution={caution} />
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={onViewSource}
        className={cn(
          'mt-2xs inline-flex w-fit items-center gap-2xs rounded-sm text-sm font-bold',
          'text-primary transition-opacity duration-fast ease-standard active:opacity-70',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
        )}
      >
        {COPY.cardDeepLink}
        <span aria-hidden="true">→</span>
      </button>
    </Card>
  );
}

/** A single key figure (금액·기간·날짜) as an emphasized chip. */
function FigureChip({ figure, caution }: { figure: ClauseFigure; caution: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-xs py-2xs text-sm font-bold',
        caution ? 'bg-surface text-foreground' : 'bg-surface-muted text-foreground',
      )}
    >
      <span className="sr-only">{COPY.figureLabel[figure.kind]} </span>
      {figure.value}
    </span>
  );
}
