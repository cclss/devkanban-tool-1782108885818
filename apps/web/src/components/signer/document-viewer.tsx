'use client';

/**
 * DocumentViewer — the signer's mobile-first reading + signing surface.
 *
 * After identity is confirmed, this renders the contract PDF fit-to-width as a
 * vertical, multi-page scroll (skeleton-shimmer per page while it rasterizes).
 * Each assigned field is overlaid on its page via `normToPx`: an unfilled field
 * breathes with a pulse highlight and a "여기에 서명" affordance; a filled field
 * shows its captured value inline. A safe-area-aware bottom CTA tracks progress —
 * "서명하기" jumps to (and opens) the next unfilled field, flipping to
 * "서명 완료" once nothing is left.
 *
 * The signer holds no File, so the document is streamed from the session-guarded
 * `/signing/:token/pdf` endpoint and opened with `loadPdfFromUrl`. Field values
 * and the open-sheet target live in the signer context: the capture BottomSheet
 * binds to that same state.
 *
 * In the guided sequential mode (`signing` phase, M3 — `conventions/signing-flow.md`
 * SF1–SF7; orchestrated by grain-3's `signer-context.tsx`, sheet chrome by grain-4)
 * this viewer is the *substrate* the flow runs on top of. The bottom CTA / a field
 * tap hand off to the context's `openField`, which enters the guided flow from the
 * `viewing` fallback (SF1/SF2); the unfilled queue comes from the context's
 * `orderedUnfilled` (the sequencing single source, SF3 — no local re-sort). While
 * signing, the substrate follows the flow: the active field is scrolled into view
 * on entry / auto-advance / save-less nav (reduced-motion-aware, SF4). The
 * cumulative progress line is a polite live region, kept distinct from the sheet's
 * positional announce (SF4). The fallback `complete()` still rejects for this CTA
 * to surface a friendly retry (I4); guided completion/`signingError` is the sheet's.
 */

import * as React from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { brandStyle } from '@/lib/branding';
import {
  getSignerSession,
  signerPdfUrl,
  SIGNER_COPY,
  type SignFieldType,
  type SigningMeta,
  type SigningPayloadField,
} from '@/lib/signing';
import {
  loadPdfFromUrl,
  renderPageToCanvas,
  isRenderCancelled,
  PdfRenderError,
  type PdfDocument,
} from '@/lib/pdf';
import { normToPx, type PageSize } from '@/lib/field-geometry';
import { useSigner, type SignerFieldValue } from './signer-context';
import { BrandingHeader } from './branding-header';
import { SignatureInputSheet } from './signature-sheet';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Korean field-type label, reused for accessibility copy. */
const TYPE_LABEL: Record<SignFieldType, string> = {
  SIGNATURE: '서명',
  DATE: '날짜',
  TEXT: '텍스트',
};

/** Stable DOM id so the CTA / a tap can scroll a field into view. */
function fieldDomId(id: string): string {
  return `signer-field-${id}`;
}

export function DocumentViewer({ meta }: { meta: SigningMeta }) {
  // `orderedUnfilled` (the unfilled queue in guided walk order, page → top → left)
  // is the context's sequencing single source (SF3, signing-flow-impl.md I2): the
  // viewer consumes it rather than re-sorting locally, so the guided flow and the
  // page overlay always walk the same fields.
  const { token, state, openField, complete, orderedUnfilled } = useSigner();
  const { payload, fieldValues, phase, activeFieldId } = state;

  // Finalize state for the bottom CTA. A failed `complete` keeps every captured
  // value in place (the context never clears them), so the signer just retries.
  const [completing, setCompleting] = React.useState(false);
  const [completeError, setCompleteError] = React.useState<string | null>(null);

  const session = React.useMemo(() => getSignerSession(token), [token]);
  const fields = React.useMemo(() => payload?.fields ?? [], [payload]);

  const [doc, setDoc] = React.useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [status, setStatus] = React.useState<LoadStatus>('loading');
  const [error, setError] = React.useState<string>(SIGNER_COPY.viewerLoadError);

  // Open the streamed PDF once per session; dispose on unmount.
  React.useEffect(() => {
    if (!session) {
      setStatus('error');
      setError(SIGNER_COPY.viewerLoadError);
      return;
    }
    let disposed = false;
    let opened: PdfDocument | null = null;
    setStatus('loading');
    loadPdfFromUrl(signerPdfUrl(token), {
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
        setError(err instanceof PdfRenderError ? err.message : SIGNER_COPY.viewerLoadError);
        setStatus('error');
      });
    return () => {
      disposed = true;
      void opened?.destroy();
    };
  }, [token, session]);

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

  const remaining = orderedUnfilled.length;
  const total = fields.length;

  // Center a field in the scroll column. Honors reduced-motion: the global
  // `globals.css` fallback forces CSS `scroll-behavior: auto`, but that can't
  // reach an explicit JS `scrollIntoView({ behavior: 'smooth' })` (the option
  // wins over CSS), so we read the media query and drop to an instant jump (the
  // `matchMedia` posture mirrors `wizard/fields-step.tsx`; no new util/hook).
  const scrollToField = React.useCallback((id: string) => {
    const el = document.getElementById(fieldDomId(id));
    if (!el) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, []);

  // A field tap hands off to the context's `openField`: from the `viewing` fallback
  // it enters the guided flow targeting that field (SF1/SF2, I1); within `signing`
  // it's a non-linear override (jump to any field). Either way the tracking effect
  // below centers it.
  const onFieldTap = React.useCallback((field: SigningPayloadField) => openField(field.id), [openField]);

  const onCta = React.useCallback(async () => {
    const next = orderedUnfilled[0];
    if (next) {
      // Enter (from the `viewing` fallback) or resume (within `signing`) the guided
      // flow via the context's `openField` — the grain-3 entry contract (I1). The
      // tracking effect below scrolls the opened field into view.
      openField(next.id);
      return;
    }
    // All fields captured: finalize. On success the context flips to `done` and
    // this viewer unmounts for the completion screen; on failure we surface the
    // server's Toss-tone message and let the signer retry (values are retained).
    if (completing) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await complete();
    } catch (err) {
      setCompleteError(err instanceof ApiError ? err.message : SIGNER_COPY.completeError);
      setCompleting(false);
    }
  }, [orderedUnfilled, openField, complete, completing]);

  // Guided substrate tracking (SF3/SF4): while signing, the viewer follows the
  // flow — whenever the active field changes (entry, '적용' auto-advance, save-less
  // '이전'/'다음'/'나중에' nav) the field is centered behind the sheet so the signer
  // sees where each capture lands. `status` is a dep so entry re-centers once the
  // pages have rasterized. Inert outside `signing` (the free-browse fallback) and
  // when the sheet is closed (`activeFieldId` null). Reduced-motion via scrollToField.
  React.useEffect(() => {
    if (phase !== 'signing' || !activeFieldId) return;
    scrollToField(activeFieldId);
  }, [phase, activeFieldId, status, scrollToField]);

  const progress =
    total === 0
      ? '서명할 항목이 없어요.'
      : remaining === 0
        ? '모든 항목을 작성했어요.'
        : `서명할 항목 ${total}곳 중 ${total - remaining}곳을 작성했어요.`;

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col px-lg pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="mt-lg">
        <h1 className="truncate text-xl font-bold text-foreground">
          {payload?.documentTitle ?? meta.documentTitle}
        </h1>
        {/* Cumulative completion tally as a polite live region so screen-reader
            users hear progress as the queue shrinks. Distinct from the sheet's
            positional announce ("N곳 중 M곳째, … 차례예요", SF4): one is a running
            tally, the other the current step. No conflict — the capture Sheet is a
            modal Dialog that aria-hides this content while open, so the sheet owns
            the announce during active capture and this tally speaks between beats
            (and in the free-browse fallback). */}
        <p aria-live="polite" className="mt-2xs text-sm text-foreground-subtle">
          {progress}
        </p>
      </div>

      <div
        ref={pagesRef}
        className="mt-lg flex flex-col gap-lg"
        // Clear the fixed CTA at the end of the scroll (layout clearance, not a
        // design value — derived from the bar's measured height).
        style={{ paddingBottom: ctaHeight ? ctaHeight + 24 : undefined }}
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
            {remaining > 0 ? SIGNER_COPY.viewerCtaContinue : SIGNER_COPY.viewerCtaComplete}
          </Button>
        </div>
      </div>

      {/* The capture BottomSheet targets the field opened via the signer context. */}
      <SignatureInputSheet />
    </main>
  );
}

interface PdfPageViewProps {
  doc: PdfDocument;
  pageNumber: number;
  /** Fit-to-width target in CSS px. */
  width: number;
  fields: SigningPayloadField[];
  fieldValues: Record<string, SignerFieldValue>;
  onFieldTap: (field: SigningPayloadField) => void;
}

/** One PDF page rasterized fit-to-width, with its field overlay on top. */
function PdfPageView({ doc, pageNumber, width, fields, fieldValues, onFieldTap }: PdfPageViewProps) {
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
    <div className="relative w-full">
      {ready ? null : status === 'error' ? (
        <div className="flex aspect-[1/1.414] w-full items-center justify-center rounded-sm border border-border bg-surface-muted px-md text-center">
          <p className="text-sm text-foreground-muted">{`${pageNumber}페이지를 불러올 수 없어요.`}</p>
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
              onTap={() => onFieldTap(field)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface FieldOverlayProps {
  field: SigningPayloadField;
  pageSize: PageSize;
  value: SignerFieldValue | undefined;
  onTap: () => void;
}

/** A single field box positioned over the page: pulse affordance, or its value. */
function FieldOverlay({ field, pageSize, value, onTap }: FieldOverlayProps) {
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
        {SIGNER_COPY.fieldAffordance[field.type]}
      </span>
    </button>
  );
}

/** Renders the captured value inside a filled field box. */
function FieldValueContent({
  field,
  value,
}: {
  field: SigningPayloadField;
  value: SignerFieldValue | undefined;
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
