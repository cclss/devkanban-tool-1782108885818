'use client';

/**
 * DocumentViewer — the recipient's mobile-first reading + filling surface.
 *
 * After access is granted, this renders the contract PDF fit-to-width as a
 * vertical, multi-page scroll (skeleton-shimmer per page while it rasterizes).
 * Each assigned field is overlaid on its page via `normToPx`: an unfilled field
 * breathes with a pulse highlight and a "여기에 …" affordance; a filled field
 * shows its captured value inline. The contract body itself is a rasterized
 * image — only the overlaid fields are interactive, so the recipient can read
 * but never edit the document text (grain-6 constraint). A safe-area-aware
 * bottom CTA tracks progress and finalizes once nothing is left.
 *
 * The recipient holds no File, so the document is streamed from the
 * session-guarded PDF endpoint (`pdfUrl`) and opened with `loadPdfFromUrl`. All
 * flow-specific wiring — the PDF URL, the bearer session, the save endpoint, and
 * copy — comes from the {@link useFill} adapter, so the OTP signer flow and the
 * link-share recipient flow reuse this one screen verbatim.
 */

import * as React from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { brandStyle } from '@/lib/branding';
import type { SignFieldType } from '@/lib/signing';
import {
  loadPdfFromUrl,
  renderPageToCanvas,
  isRenderCancelled,
  PdfRenderError,
  type PdfDocument,
} from '@/lib/pdf';
import { normToPx, type PageSize } from '@/lib/field-geometry';
import { useFill, type FillField, type FillFieldValue } from './fill-context';
import { BrandingHeader } from './branding-header';
import { ClauseSummarySection } from './clause-summary-section';
import { SignatureInputSheet } from './signature-sheet';
import { CLAUSE_CARD_COPY } from '@/lib/clause-card-copy';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Korean field-type label, reused for accessibility copy. */
const TYPE_LABEL: Record<SignFieldType, string> = {
  SIGNATURE: '서명',
  DATE: '날짜',
  TEXT: '텍스트',
};

/** Stable DOM id so the CTA / a tap can scroll a field into view. */
function fieldDomId(id: string): string {
  return `fill-field-${id}`;
}

/**
 * Stable per-page anchor id in its own namespace (never collides with
 * {@link fieldDomId}), so `expandAndScrollToPage` and a clause card's
 * "원문에서 보기" (a later grain) can jump to a specific original page.
 */
function pageAnchorId(pageNumber: number): string {
  return `pdf-page-${pageNumber}`;
}

/** The pages region the toggle shows/hides (`aria-controls` target). */
const ORIGINAL_PAGES_ID = 'original-pages';

/** A field is done when a value was captured, or the server already has one. */
function isFilled(field: FillField, values: Record<string, FillFieldValue>): boolean {
  return values[field.id] != null || field.filled;
}

/** Top edge (px) of a field on its page — for top-to-bottom reading order. */
function topOf(field: FillField): number {
  return 1 - field.y - field.height; // normalized; page-height-independent ordering
}

export function DocumentViewer() {
  const {
    sender,
    brandColor,
    documentTitle,
    payload,
    clauseSummary,
    fieldValues,
    pdfUrl,
    loadSession,
    openField,
    complete,
    copy,
  } = useFill();

  // Finalize state for the bottom CTA. A failed `complete` keeps every captured
  // value in place (the context never clears them), so the recipient just retries.
  const [completing, setCompleting] = React.useState(false);
  const [completeError, setCompleteError] = React.useState<string | null>(null);

  // Collapsible "원문" (original) section. Summary-first: when a clause summary
  // exists the original is collapsed by default (read the key clauses first, open
  // the full document only when needed); with no summary (fallback) it stays
  // expanded so the plain viewer behaves exactly as before.
  const hasSummary = clauseSummary != null;
  const [originalExpanded, setOriginalExpanded] = React.useState(() => !hasSummary);
  // A scroll deferred until the pages mount/measure after an expand (opening the
  // original then jumping to a page/field within it).
  const [pendingScroll, setPendingScroll] = React.useState<
    { kind: 'page'; page: number } | { kind: 'field'; id: string } | null
  >(null);

  const session = React.useMemo(() => loadSession(), [loadSession]);
  const fields = React.useMemo(() => payload?.fields ?? [], [payload]);

  const [doc, setDoc] = React.useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [status, setStatus] = React.useState<LoadStatus>('loading');
  const [error, setError] = React.useState<string>(copy.loadError);

  // Open the streamed PDF once per session; dispose on unmount.
  React.useEffect(() => {
    if (!session) {
      setStatus('error');
      setError(copy.loadError);
      return;
    }
    let disposed = false;
    let opened: PdfDocument | null = null;
    setStatus('loading');
    loadPdfFromUrl(pdfUrl, {
      headers: { Authorization: `Bearer ${session}` },
      cache: 'no-store',
    })
      .then((result) => {
        if (disposed) {
          void result.doc.destroy();
          return;
        }
        opened = result.doc;
        setDoc(result.doc);
        setPageCount(result.pageCount);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof PdfRenderError ? err.message : copy.loadError);
        setStatus('error');
      });
    return () => {
      disposed = true;
      void opened?.destroy();
    };
  }, [pdfUrl, session, copy.loadError]);

  // Measure the page column so each page rasterizes exactly fit-to-width.
  const pagesRef = React.useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const measure = () => setPageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Re-measure the moment the original expands: it goes from `hidden`
  // (display:none, width 0) to laid out, so pages can rasterize fit-to-width.
  React.useLayoutEffect(() => {
    if (originalExpanded && pagesRef.current) setPageWidth(pagesRef.current.clientWidth);
  }, [originalExpanded]);

  // Measure the fixed CTA so the last page can clear it when scrolled to bottom.
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

  const orderedUnfilled = React.useMemo(
    () =>
      [...fields]
        .filter((f) => !isFilled(f, fieldValues))
        .sort((a, b) => a.page - b.page || topOf(a) - topOf(b) || a.x - b.x),
    [fields, fieldValues],
  );
  const remaining = orderedUnfilled.length;
  const total = fields.length;

  const scrollToField = React.useCallback((id: string) => {
    document.getElementById(fieldDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToPage = React.useCallback((page: number) => {
    document.getElementById(pageAnchorId(page))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /**
   * Imperative handle exposed to the clause summary section (a later grain wires
   * the card's "원문에서 보기" link to it): open the collapsed original and scroll
   * to a source page. The scroll is deferred via `pendingScroll` until the pages
   * have mounted/measured after the expand.
   */
  const expandAndScrollToPage = React.useCallback((page: number) => {
    setOriginalExpanded(true);
    setPendingScroll({ kind: 'page', page });
  }, []);

  // Honor a deferred scroll once the original is expanded and measured (pageWidth
  // > 0 means the page anchors have mounted). Best-effort and one-shot.
  React.useEffect(() => {
    if (!originalExpanded || !pendingScroll || pageWidth === 0) return;
    const raf = requestAnimationFrame(() => {
      if (pendingScroll.kind === 'page') scrollToPage(pendingScroll.page);
      else scrollToField(pendingScroll.id);
      setPendingScroll(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [originalExpanded, pendingScroll, pageWidth, scrollToPage, scrollToField]);

  const onFieldTap = React.useCallback(
    (field: FillField) => {
      scrollToField(field.id);
      openField(field.id);
    },
    [openField, scrollToField],
  );

  const onCta = React.useCallback(async () => {
    const next = orderedUnfilled[0];
    if (next) {
      // Fields live inside the original; if it's collapsed, open it first and
      // defer the scroll until the target page has mounted.
      if (originalExpanded) {
        scrollToField(next.id);
      } else {
        setOriginalExpanded(true);
        setPendingScroll({ kind: 'field', id: next.id });
      }
      openField(next.id);
      return;
    }
    // All fields captured: finalize. On success the flow flips to `done` and this
    // viewer unmounts for the completion screen; on failure we surface the
    // server's Toss-tone message and let the recipient retry (values are kept).
    if (completing) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await complete();
    } catch (err) {
      setCompleteError(err instanceof ApiError ? err.message : copy.completeError);
      setCompleting(false);
    }
  }, [
    orderedUnfilled,
    scrollToField,
    openField,
    complete,
    completing,
    copy.completeError,
    originalExpanded,
  ]);

  const progress =
    total === 0
      ? copy.progressNone
      : remaining === 0
        ? copy.progressAllDone
        : copy.progress(total, total - remaining);

  return (
    <main
      style={{
        ...brandStyle(brandColor),
        // Clear the fixed CTA in every state (collapsed or expanded) so no
        // content is hidden behind it (layout clearance, not a design value —
        // derived from the bar's measured height).
        paddingBottom: ctaHeight ? ctaHeight + 24 : undefined,
      }}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pt-xl"
    >
      <BrandingHeader sender={sender} />

      <div className="mt-lg">
        <h1 className="truncate text-xl font-bold text-foreground">
          {payload?.documentTitle ?? documentTitle}
        </h1>
        <p className="mt-2xs text-sm text-foreground-subtle">{progress}</p>
      </div>

      {/* Summary-first: the AI key-clause summary sits above the original pages.
          Rendered only when a summary exists; a `null` summary falls back to the
          plain original viewer (design-spec/components/clause-summary-section).
          `onViewSource` exposes the imperative expand-and-scroll handle for the
          clause card "원문에서 보기" link (wired in a later grain). */}
      {clauseSummary ? (
        <ClauseSummarySection summary={clauseSummary} onViewSource={expandAndScrollToPage} />
      ) : null}

      {/* The collapsible "원문" toggle sits at the summary→original boundary
          (below the cards, above the CTA). Only shown when there's a summary to
          collapse under — the fallback viewer has nothing above it to fold. */}
      {hasSummary ? (
        <button
          type="button"
          onClick={() => setOriginalExpanded((v) => !v)}
          aria-expanded={originalExpanded}
          aria-controls={ORIGINAL_PAGES_ID}
          className={cn(
            'mt-md flex w-full items-center justify-between gap-xs rounded-md',
            'border border-border bg-surface px-md py-sm text-sm font-semibold text-foreground',
            'transition-colors duration-fast ease-standard hover:bg-surface-muted',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
          )}
        >
          <span>
            {originalExpanded
              ? CLAUSE_CARD_COPY.originalToggleCollapse
              : CLAUSE_CARD_COPY.originalToggleExpand(pageCount)}
          </span>
          <ChevronIcon expanded={originalExpanded} />
        </button>
      ) : null}

      {/* Collapsed = `hidden` (display:none) rather than the `hidden` attribute,
          which the `flex` utility would override. Kept mounted so the ref/width
          measurement and page anchors survive a collapse; pages only rasterize
          once width is measured (on expand). */}
      <div
        id={ORIGINAL_PAGES_ID}
        ref={pagesRef}
        aria-label="계약 원문"
        aria-hidden={!originalExpanded}
        className={cn(
          originalExpanded ? 'flex flex-col gap-lg' : 'hidden',
          hasSummary ? 'mt-sm' : 'mt-lg',
        )}
      >
        {status === 'error' ? (
          <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-xs rounded-md border border-border bg-surface-muted px-md text-center">
            <p className="text-sm text-foreground-muted">{error}</p>
          </div>
        ) : status === 'loading' || !doc || pageWidth === 0 ? (
          <Skeleton className="aspect-[1/1.414] w-full" />
        ) : (
          Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
            <PdfPageView
              key={pageNumber}
              doc={doc}
              pageNumber={pageNumber}
              width={pageWidth}
              fields={fields.filter((f) => f.page === pageNumber)}
              fieldValues={fieldValues}
              affordance={copy.fieldAffordance}
              pageError={copy.pageError}
              onFieldTap={onFieldTap}
            />
          ))
        )}
      </div>

      <div
        ref={ctaRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto w-full max-w-[480px] px-lg py-md">
          {completeError ? (
            <p
              role="alert"
              aria-live="assertive"
              className="mb-xs text-center text-sm text-danger"
            >
              {completeError}
            </p>
          ) : null}
          <Button fullWidth size="lg" onClick={onCta} isLoading={completing}>
            {remaining > 0 ? copy.ctaContinue : copy.ctaComplete}
          </Button>
        </div>
      </div>

      {/* The capture BottomSheet targets the field opened via the fill context. */}
      <SignatureInputSheet />
    </main>
  );
}

/** Disclosure chevron for the original toggle: points down collapsed, up when open. */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn(
        'h-4 w-4 shrink-0 text-foreground-subtle transition-transform duration-fast ease-standard',
        expanded && 'rotate-180',
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface PdfPageViewProps {
  doc: PdfDocument;
  pageNumber: number;
  /** Fit-to-width target in CSS px. */
  width: number;
  fields: FillField[];
  fieldValues: Record<string, FillFieldValue>;
  affordance: Record<SignFieldType, string>;
  pageError: (pageNumber: number) => string;
  onFieldTap: (field: FillField) => void;
}

/** One PDF page rasterized fit-to-width, with its field overlay on top. */
function PdfPageView({
  doc,
  pageNumber,
  width,
  fields,
  fieldValues,
  affordance,
  pageError,
  onFieldTap,
}: PdfPageViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = React.useState<PageSize | null>(null);
  const [status, setStatus] = React.useState<LoadStatus>('loading');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    let cancelled = false;
    setStatus('loading');
    renderPageToCanvas(doc, pageNumber, canvas, width)
      .then((size) => {
        if (cancelled) return;
        setPageSize({ width: size.cssWidth, height: size.cssHeight });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled || isRenderCancelled(err)) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, width]);

  const ready = status === 'ready' && pageSize !== null;

  return (
    <div id={pageAnchorId(pageNumber)} className="relative w-full scroll-mt-md">
      {ready ? null : status === 'error' ? (
        <div className="flex aspect-[1/1.414] w-full items-center justify-center rounded-sm border border-border bg-surface-muted px-md text-center">
          <p className="text-sm text-foreground-muted">{pageError(pageNumber)}</p>
        </div>
      ) : (
        <Skeleton className="aspect-[1/1.414] w-full" />
      )}

      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`계약 ${pageNumber}페이지`}
        className={cn(
          'block w-full rounded-sm border border-border bg-surface shadow-sm',
          ready ? 'animate-fade-in' : 'hidden',
        )}
      />

      {ready && pageSize ? (
        <div className="absolute inset-0">
          {fields.map((field) => (
            <FieldOverlay
              key={field.id}
              field={field}
              pageSize={pageSize}
              value={fieldValues[field.id]}
              affordance={affordance}
              onTap={() => onFieldTap(field)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface FieldOverlayProps {
  field: FillField;
  pageSize: PageSize;
  value: FillFieldValue | undefined;
  affordance: Record<SignFieldType, string>;
  onTap: () => void;
}

/** A single field box positioned over the page: pulse affordance, or its value. */
function FieldOverlay({ field, pageSize, value, affordance, onTap }: FieldOverlayProps) {
  const rect = normToPx(field, pageSize);
  const style: React.CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  const label = TYPE_LABEL[field.type];

  if (value != null || field.filled) {
    return (
      <div
        id={fieldDomId(field.id)}
        aria-label={`${label} 필드, 작성 완료`}
        className="absolute flex items-center justify-center overflow-hidden rounded-sm border border-success bg-success-subtle/30"
        style={style}
      >
        <FieldValueContent field={field} value={value} />
      </div>
    );
  }

  return (
    <button
      type="button"
      id={fieldDomId(field.id)}
      onClick={onTap}
      aria-label={`${label} 필드, 탭하여 입력해 주세요`}
      className={cn(
        'field-pulse animate-breathing-pulse absolute flex items-center justify-center rounded-sm',
        'border-2 border-primary bg-primary-subtle/40 text-2xs font-bold text-primary',
        'transition-transform duration-fast ease-standard active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
      )}
      style={style}
    >
      <span className="pointer-events-none truncate px-2xs leading-none">
        {affordance[field.type]}
      </span>
    </button>
  );
}

/** Renders the captured value inside a filled field box. */
function FieldValueContent({
  field,
  value,
}: {
  field: FillField;
  value: FillFieldValue | undefined;
}) {
  // Server-saved on a resumed session but not re-fetched into the client.
  if (!value) {
    return <span className="truncate px-2xs text-2xs font-semibold text-success">작성됨</span>;
  }
  if (value.type === 'SIGNATURE') {
    // eslint-disable-next-line @next/next/no-img-element -- in-memory data URL, not a remote asset
    return <img src={value.dataUrl} alt={`${TYPE_LABEL[field.type]} 입력값`} className="h-full w-full object-contain" />;
  }
  const fontFamily = value.type === 'TEXT' ? value.fontFamily : undefined;
  return (
    <span
      className="truncate px-2xs text-sm leading-none text-foreground"
      style={fontFamily ? { fontFamily } : undefined}
    >
      {value.text}
    </span>
  );
}
