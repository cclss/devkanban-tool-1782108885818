'use client';

/**
 * ClauseCardScreen — the AI key-clause reminder shown after identity check (M2).
 *
 * Before the signer reaches the full document, we surface the 3–5 key clauses
 * the send-time extraction produced (`state.clauses`) as a swipeable, horizontally
 * scroll-snapping card stack. Each card reminds one clause (title · summary ·
 * source-page reference), and a `caution` clause carries a calm '주의' badge with
 * the server-owned reason. The stack is an *auxiliary* reminder: legal effect
 * stays with the source document, reachable any time via '전체 원문 보기'. A single
 * sticky '서명하기' CTA hands off to the viewer (`goSigning`: clauses → viewing).
 *
 * This screen is only mounted when the reminder is `READY` with cards; the
 * non-READY / empty fallback is decided upstream in the signer context (verify
 * routes straight to `viewing`). Copy is the single source `SIGNER_COPY.clause`.
 *
 * The stack uses native CSS scroll-snap (`snap-x snap-mandatory` + `snap-center`)
 * — no carousel dependency. Motion (stagger entrance, smooth scroll) collapses
 * under `prefers-reduced-motion` via the global rules in `globals.css`.
 */

import * as React from 'react';
import { Button, Card, cn } from '@repo/ui';
import { brandStyle } from '@/lib/branding';
import { SIGNER_COPY, type ClauseCard as ClauseCardData, type SigningMeta } from '@/lib/signing';
import { useSigner } from './signer-context';
import { BrandingHeader } from './branding-header';
import { DocumentPreviewSheet } from './document-preview-sheet';

const COPY = SIGNER_COPY.clause;

export function ClauseCardScreen({ meta }: { meta: SigningMeta }) {
  const { state, goSigning, openPreview } = useSigner();
  // Only reached when the reminder is READY with cards (routed in the context),
  // so this is a non-empty array; the fallback keeps types honest regardless.
  const clauses = state.clauses ?? [];
  const total = clauses.length;

  // Track the snapped card so the dots + the live-region announcement follow the
  // signer's swipe. Derived from the scroll offset — the nearest card center to
  // the viewport center — so it stays correct for scroll, swipe, or keyboard.
  const scrollerRef = React.useRef<HTMLUListElement>(null);
  const [active, setActive] = React.useState(0);

  const onScroll = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    const items = Array.from(el.children) as HTMLElement[];
    let nearest = 0;
    let best = Infinity;
    items.forEach((item, i) => {
      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const distance = Math.abs(itemCenter - center);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    setActive((prev) => (prev === nearest ? prev : nearest));
  }, []);

  // Measure the fixed CTA bar so the scrolling content clears it at the bottom.
  const ctaRef = React.useRef<HTMLDivElement>(null);
  const [ctaHeight, setCtaHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const measure = () => setCtaHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <main
      style={{
        ...brandStyle(meta.sender.brandColor),
        // Layout clearance for the fixed CTA (derived from its measured height,
        // not a design value) — matches the document-viewer pattern.
        paddingBottom: ctaHeight ? ctaHeight + 24 : undefined,
      }}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="mt-lg">
        <h1 className="text-xl font-bold text-foreground">{COPY.title}</h1>
        <p className="mt-2xs text-sm text-foreground-subtle">{COPY.intro}</p>
      </div>

      {/* AI-summary advisory — legal effect stays with the source document. */}
      <p className="mt-md rounded-md bg-surface-muted px-md py-sm text-xs text-foreground-muted">
        {COPY.advisoryNotice}
      </p>

      {/*
        Swipeable card stack. The scroller bleeds to the screen edges (`-mx-lg`)
        and re-pads (`px-lg`) so a peek of the neighbouring card hints the swipe,
        while content stays within the reading gutter. `role="list"` keeps the
        list semantics some screen readers drop on a styled, scrolling <ul>.
      */}
      <ul
        ref={scrollerRef}
        onScroll={onScroll}
        role="list"
        aria-label={COPY.cardsRegionLabel}
        className={cn(
          'motion-stagger -mx-lg mt-lg flex snap-x snap-mandatory gap-md overflow-x-auto px-lg pb-xs',
          'scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {clauses.map((clause, i) => (
          <li
            key={`${clause.sourcePage}-${i}`}
            aria-label={COPY.cardPosition(i + 1, total)}
            aria-current={i === active ? 'true' : undefined}
            className="shrink-0 basis-[86%] snap-center"
          >
            <ClauseCardView clause={clause} />
          </li>
        ))}
      </ul>

      {/* Progress dots — decorative; position is announced in the live region. */}
      {total > 1 ? (
        <div className="mt-md flex items-center justify-center gap-2xs" aria-hidden="true">
          {clauses.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-xs rounded-full transition-[width,background-color] duration-base ease-out-expressive',
                i === active ? 'w-md bg-primary' : 'w-xs bg-border-strong',
              )}
            />
          ))}
        </div>
      ) : null}

      {/* Announce the current card to screen readers as the signer swipes. */}
      <p className="sr-only" aria-live="polite">
        {COPY.cardPosition(active + 1, total)}
      </p>

      {/*
        Collapsed, low-pressure trigger into the full document. Opens the source
        PDF as a returnable read-only overlay (grain-4) — dismissing it returns to
        this very card. Distinct from the '서명하기' CTA, which hands off to the
        signing viewer.
      */}
      <div className="mt-lg flex justify-center">
        <Button
          variant="ghost"
          onClick={openPreview}
          className="text-foreground-muted underline underline-offset-4"
        >
          {COPY.viewFull}
        </Button>
      </div>

      {/* Single sticky primary CTA into the signing viewer. */}
      <div
        ref={ctaRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto w-full max-w-[480px] px-lg py-md">
          <Button fullWidth size="lg" onClick={goSigning}>
            {COPY.cta}
          </Button>
        </div>
      </div>

      {/* Returnable read-only full-document overlay (reads `state.previewOpen`). */}
      <DocumentPreviewSheet />
    </main>
  );
}

/** One key-clause card: title, optional caution badge + reason, summary, source. */
function ClauseCardView({ clause }: { clause: ClauseCardData }) {
  return (
    <Card className="flex h-full flex-col gap-sm p-lg">
      <div className="flex items-start justify-between gap-sm">
        <h2 className="text-lg font-bold text-foreground">{clause.title}</h2>
        {clause.caution ? <CautionBadge /> : null}
      </div>

      <p className="text-base text-foreground-muted">{clause.summary}</p>

      {clause.caution && clause.cautionReason ? (
        // The reason text is server-owned (`cautionReason`), surfaced verbatim; a
        // gentle warning-tinted callout reads as "worth a second look", not alarm.
        <p className="rounded-sm bg-warning-subtle px-sm py-xs text-sm text-foreground-muted">
          {clause.cautionReason}
        </p>
      ) : null}

      <p className="mt-auto pt-xs text-xs text-foreground-subtle">
        {COPY.sourceRef(clause.sourcePage)}
      </p>
    </Card>
  );
}

/**
 * '주의' badge for a caution clause. Follows the StatusBadge convention — the hue
 * rides a leading colored dot on a subtle tint while the label stays dark, since
 * warning-on-tint text fails WCAG AA at this size, and color is never the only
 * signal (the '주의' label is always present).
 */
function CautionBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-2xs rounded-full bg-warning-subtle px-xs py-2xs text-xs font-semibold text-foreground-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
      {COPY.cautionBadge}
    </span>
  );
}
