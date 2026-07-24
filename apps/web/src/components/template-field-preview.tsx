'use client';

/**
 * TemplateFieldPreview — a read-only look at where a template's fields sit on its
 * source PDF (design-spec `components/template-field-preview/base.md`, copy
 * `lib/templates-copy.ts` `TEMPLATE_FIELD_PREVIEW_COPY`).
 *
 * Given the template's original `File` and its saved field layout, this renders
 * one PDF page at a time onto a raster `<canvas>` (via `lib/pdf.ts`) and lays a
 * pointer-inert overlay of read-only field boxes on top — each positioned from
 * its normalized 0..1 geometry with `normToPx`, so the boxes track the page at
 * any render size. Multi-page templates get prev/next page controls.
 *
 * This is a pure display surface: it shares the *visual language* of the wizard's
 * `field-canvas` (dashed primary box on a `primary-subtle` fill) but reuses none
 * of its interaction logic — no drag, resize, handles, selection, or keyboard
 * assist. It only reads geometry; it never mutates a field. That keeps the stored
 * field-geometry contract untouched while letting a sender confirm a saved layout.
 */

import * as React from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import {
  openPdf,
  renderPageToCanvas,
  isRenderCancelled,
  PdfRenderError,
  type PdfDocument,
} from '@/lib/pdf';
import { normToPx, FIELD_TYPE_META, type PageSize, type SignFieldType } from '@/lib/field-geometry';
import { TEMPLATE_FIELD_PREVIEW_COPY as COPY } from '@/lib/templates-copy';

/**
 * The minimal field shape this surface needs: a type, its 1-based page, its
 * normalized 0..1 geometry, and (optionally) the recipient slot it belongs to.
 * Both `SignFieldDraft` and the persisted `TemplateField` satisfy it structurally.
 */
export interface PreviewField {
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-based recipient slot; absent means the sole (first) recipient. */
  recipientIndex?: number;
}

type Status = 'loading' | 'ready' | 'error';

export interface TemplateFieldPreviewProps {
  /** The template's original PDF. */
  file: File;
  /** The saved layout to overlay, in normalized 0..1 geometry. */
  fields: readonly PreviewField[];
  /** Upper bound on the rendered page width (CSS px). */
  maxWidth?: number;
  className?: string;
}

export function TemplateFieldPreview({
  file,
  fields,
  maxWidth = 480,
  className,
}: TemplateFieldPreviewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const docRef = React.useRef<PdfDocument | null>(null);

  const [docReady, setDocReady] = React.useState(false);
  const [pageCount, setPageCount] = React.useState(0);
  const [page, setPage] = React.useState(1); // 1-based
  const [status, setStatus] = React.useState<Status>('loading');
  const [error, setError] = React.useState<string>(COPY.error);
  const [pageSize, setPageSize] = React.useState<PageSize | null>(null);
  const [width, setWidth] = React.useState(0);

  // Open the document once per file; dispose on unmount / file change.
  React.useEffect(() => {
    let disposed = false;
    setDocReady(false);
    setStatus('loading');
    setPage(1);
    openPdf(file)
      .then(({ doc, pageCount: count }) => {
        if (disposed) {
          void doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(count);
        setDocReady(true);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setError(err instanceof PdfRenderError ? err.message : COPY.error);
        setStatus('error');
      });
    return () => {
      disposed = true;
      setDocReady(false);
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [file]);

  // Measure the column so each page rasterizes fit-to-width (capped at maxWidth).
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(el.clientWidth || maxWidth, maxWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  // Render the current page whenever it, the width, or the open document changes.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !docReady || !doc || !width) return;
    let cancelled = false;
    setStatus('loading');
    renderPageToCanvas(doc, page, canvas, width)
      .then((size) => {
        if (cancelled) return;
        setPageSize({ width: size.cssWidth, height: size.cssHeight });
        setStatus('ready');
        setError(COPY.error);
      })
      .catch((err: unknown) => {
        if (cancelled || isRenderCancelled(err)) return;
        setError(err instanceof PdfRenderError ? err.message : COPY.error);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [docReady, page, width]);

  const pageFields = React.useMemo(
    () => fields.filter((f) => f.page === page),
    [fields, page],
  );

  // Field types present across the whole template — drives the legend.
  const presentTypes = React.useMemo(() => {
    const seen = new Set<SignFieldType>();
    for (const f of fields) seen.add(f.type);
    // Stable order: follow FIELD_TYPE_META's declared order, keep only present types.
    return Object.values(FIELD_TYPE_META)
      .map((m) => m.type)
      .filter((t) => seen.has(t));
  }, [fields]);

  // Recipient badges only earn their space when a template targets 2+ signers.
  const hasMultipleRecipients = React.useMemo(() => {
    const seen = new Set<number>();
    for (const f of fields) seen.add(f.recipientIndex ?? 0);
    return seen.size > 1;
  }, [fields]);

  const ready = status === 'ready' && pageSize !== null;
  const canPrev = page > 1;
  const canNext = page < pageCount;

  return (
    <div className={cn('flex w-full flex-col gap-md', className)}>
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-md">
          <Button
            variant="ghost"
            size="sm"
            aria-label={COPY.prevPage}
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronIcon direction="left" />
          </Button>
          <span
            aria-live="polite"
            className="min-w-[3.5rem] text-center text-sm font-semibold tabular-nums text-foreground-muted"
          >
            {COPY.pageIndicator(page, pageCount)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={COPY.nextPage}
            disabled={!canNext}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            <ChevronIcon direction="right" />
          </Button>
        </div>
      ) : null}

      <div ref={containerRef} className="relative w-full">
        {ready ? null : status === 'error' ? (
          <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-xs rounded-md border border-border bg-surface-muted px-md text-center">
            <p className="text-sm text-foreground-muted">{error}</p>
          </div>
        ) : (
          <Skeleton className="mx-auto aspect-[1/1.414] w-full" />
        )}

        {/* The page raster + its read-only field overlay, sized to the render. */}
        <div
          className={cn('relative mx-auto', ready ? 'animate-fade-in' : 'hidden')}
          style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={COPY.pageLabel(page, Math.max(pageCount, 1))}
            className="block w-full rounded-sm border border-border bg-surface shadow-sm"
          />

          {ready && pageSize ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {pageFields.map((field, i) => (
                <ReadonlyFieldBox
                  key={i}
                  field={field}
                  pageSize={pageSize}
                  showRecipient={hasMultipleRecipients}
                />
              ))}

              {pageFields.length === 0 ? (
                <div className="absolute inset-x-0 bottom-md flex justify-center">
                  <span className="rounded-sm bg-surface/90 px-sm py-2xs text-xs text-foreground-subtle shadow-xs">
                    {COPY.noFieldsOnPage}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Legend — decodes the box colors/glyphs; static, non-interactive. */}
      {presentTypes.length > 0 ? (
        <div className="flex flex-col gap-2xs">
          <div className="flex flex-wrap items-center gap-x-md gap-y-2xs">
            <span className="text-xs font-semibold text-foreground-subtle">{COPY.legendLabel}</span>
            {presentTypes.map((type) => (
              <span key={type} className="flex items-center gap-2xs text-xs text-foreground-muted">
                <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-primary/60 bg-primary-subtle text-primary">
                  <FieldGlyph type={type} />
                </span>
                {FIELD_TYPE_META[type].label}
              </span>
            ))}
          </div>
          {hasMultipleRecipients ? (
            <p className="text-xs text-foreground-subtle">{COPY.recipientHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ReadonlyFieldBoxProps {
  field: PreviewField;
  pageSize: PageSize;
  showRecipient: boolean;
}

/** One placed field, drawn read-only over the page: type glyph + label, and an
 *  optional recipient-order badge. No handles, no pointer target. */
function ReadonlyFieldBox({ field, pageSize, showRecipient }: ReadonlyFieldBoxProps) {
  const rect = normToPx(field, pageSize);
  const meta = FIELD_TYPE_META[field.type];
  const recipient = (field.recipientIndex ?? 0) + 1;
  return (
    <div
      className="absolute flex items-center justify-center rounded-sm border-2 border-dashed border-primary/60 bg-primary-subtle/40 text-xs font-semibold text-primary"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      {showRecipient ? (
        <span
          className="absolute -left-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full border border-surface bg-primary px-1 text-2xs font-bold leading-none text-primary-foreground"
          aria-hidden="true"
        >
          {recipient}
        </span>
      ) : null}
      <span className="flex items-center gap-2xs truncate px-2xs">
        <FieldGlyph type={field.type} />
        {meta.label}
      </span>
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('h-4 w-4', direction === 'left' ? 'rotate-180' : '')}
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FieldGlyph({ type }: { type: SignFieldType }) {
  if (type === 'SIGNATURE') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path
          d="M2 12c2-1 3-7 5-7s1 5 3 5 2-3 4-3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (type === 'DATE') {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M4 4h8M8 4v8M6.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
