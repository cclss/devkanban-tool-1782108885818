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
 * Zoom: the fit-to-width layout is the 1× baseline. A pinch (two-pointer) gesture
 * and on-screen +/−/reset controls magnify the pages up to `--zoom-scale-max`;
 * when zoomed the enlarged pages pan by native scroll in both axes. The pinch is
 * captured on the viewport only (its `touch-action` flips to `none` for the two
 * fingers), so it never collides with the signature pad's own `touch-none`
 * drawing surface — the two live in separate touch-action scopes. During the
 * pinch the column is scaled with a cheap CSS transform for smooth feedback; on
 * release the pages re-rasterize once at the settled zoom (a natural debounce),
 * sharp up to the 2× device-pixel ceiling.
 *
 * Page navigation: for multi-page contracts a bottom-centre floating pill shows
 * the current / total page with prev·next jumps that smooth-scroll the page to
 * the top of the viewport. The indicator follows the scroll via an
 * IntersectionObserver center-band scrollspy, so it stays in sync whether the
 * signer scrolls, taps a jump, or is zoomed in. Like the zoom controls it floats
 * on the viewport (not the scrolling column), staying in one-hand reach and
 * above the in-flow CTA.
 *
 * The signer holds no File, so the document is streamed from the session-guarded
 * `/signing/:token/pdf` endpoint and opened with `loadPdfFromUrl`. Field values
 * and the open-sheet target live in the signer context: the capture BottomSheet
 * (and the real submit/complete) are later grains that bind to that same state.
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

/** Device pixel ratio, capped at 2× (the sharpness ceiling for raster budget). */
const DPR_CAP = 2;
/**
 * Zoom beyond which the raster no longer grows (the CSS box still enlarges, the
 * browser upscales the bitmap). Keeps deep-zoom memory bounded on low-end phones
 * while staying crisp through the common 1×–2× range.
 */
const RASTER_SHARP_ZOOM = 2;

/** Fallback zoom bounds if the CSS custom properties can't be read (SSR / tests). */
const ZOOM_FALLBACK = { min: 1, max: 2.5, step: 0.5 };

/**
 * Read the document-zoom scale bounds from their design-token CSS variables,
 * mirroring how the signature pad resolves `--color-foreground` at runtime — the
 * values live in one place (globals.css `:root`) rather than hardcoded here.
 */
function readZoomScale(): { min: number; max: number; step: number } {
  if (typeof window === 'undefined') return ZOOM_FALLBACK;
  const root = getComputedStyle(document.documentElement);
  const num = (name: string, fallback: number) => {
    const v = parseFloat(root.getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    min: num('--zoom-scale-min', ZOOM_FALLBACK.min),
    max: num('--zoom-scale-max', ZOOM_FALLBACK.max),
    step: num('--zoom-scale-step', ZOOM_FALLBACK.step),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Stable DOM id so the CTA / a tap can scroll a field into view. */
function fieldDomId(id: string): string {
  return `signer-field-${id}`;
}

/** A field is done when the signer captured a value, or the server has one. */
function isFilled(field: SigningPayloadField, values: Record<string, SignerFieldValue>): boolean {
  return values[field.id] != null || field.filled;
}

/** Top edge (px) of a field on its page — for top-to-bottom reading order. */
function topOf(field: SigningPayloadField): number {
  return 1 - field.y - field.height; // normalized; page-height-independent ordering
}

export function DocumentViewer({ meta }: { meta: SigningMeta }) {
  const { token, state, openField, complete } = useSigner();
  const { payload, fieldValues } = state;

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

  // ── Zoom / pan ──────────────────────────────────────────────────────────
  // `viewportRef` is the fixed clip window (its width is the 1× fit-to-width
  // basis, measured); `pagesColRef` is the enlarged pages column that pans by
  // native scroll inside the viewport.
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const pagesColRef = React.useRef<HTMLDivElement>(null);
  const [basePageWidth, setBasePageWidth] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const zoomRef = React.useRef(1);
  zoomRef.current = zoom;

  const scale = React.useMemo(readZoomScale, []);

  // Live pinch preview: a CSS transform applied to the column for smooth feedback
  // before the settled re-render. Null when not pinching.
  const [preview, setPreview] = React.useState<{ s: number; ox: number; oy: number } | null>(null);
  // True while two fingers are down — flips the viewer's touch-action to `none`
  // so the browser hands us the pinch instead of scrolling/zooming the page.
  const [pinching, setPinching] = React.useState(false);

  // Current page (1-based) inferred from the scroll position — drives the
  // thumb-reach page-nav indicator. Stays valid while zoomed (the pages stay a
  // vertical stack; only their size changes).
  const [currentPage, setCurrentPage] = React.useState(1);

  const isReady = status === 'ready' && !!doc && basePageWidth > 0;

  // Measure the clip window (stable — it does not grow with zoom).
  React.useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setBasePageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sync the current-page indicator to the scroll position. A center-band
  // `rootMargin` collapses the observation root to a horizontal line at the
  // viewport's vertical middle, so exactly the page crossing that line reports
  // as intersecting — the classic scrollspy technique. Works unchanged while
  // zoomed (only the vertical band matters; horizontal pan is ignored).
  React.useEffect(() => {
    const root = viewportRef.current;
    if (!root || !isReady || pageCount === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (n) setCurrentPage(n);
        }
      },
      { root, rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    const pages = root.querySelectorAll<HTMLElement>('[data-page-number]');
    pages.forEach((page) => io.observe(page));
    return () => io.disconnect();
  }, [isReady, pageCount]);

  // Committed display width of each page (drives layout, pan area, overlay geom).
  const displayWidth = basePageWidth * zoom;
  // Raster cap in device px: sharp through `RASTER_SHARP_ZOOM`, upscaled beyond.
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, DPR_CAP) : 1;
  const maxCanvasWidth = basePageWidth * RASTER_SHARP_ZOOM * dpr;

  // Re-center scroll so `contentPt` (px in the OLD zoom's column coords) stays
  // under the same viewport point `vp` after the zoom changes to `next`.
  const applyZoom = React.useCallback(
    (next: number, vp: { x: number; y: number }, contentPt: { x: number; y: number }) => {
      const clamped = clamp(Math.round(next * 100) / 100, scale.min, scale.max);
      const prev = zoomRef.current;
      if (clamped === prev) return;
      setZoom(clamped);
      const ratio = clamped / prev;
      // Layout width updates synchronously with the state commit; adjust scroll on
      // the next frame once the enlarged column can accept the new offsets.
      requestAnimationFrame(() => {
        const el = viewportRef.current;
        if (!el) return;
        el.scrollLeft = contentPt.x * ratio - vp.x;
        el.scrollTop = contentPt.y * ratio - vp.y;
      });
    },
    [scale.min, scale.max],
  );

  // Zoom controls step from/toward the viewport centre.
  const stepZoom = React.useCallback(
    (delta: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const vp = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const contentPt = { x: el.scrollLeft + vp.x, y: el.scrollTop + vp.y };
      applyZoom(zoomRef.current + delta, vp, contentPt);
    },
    [applyZoom],
  );
  const resetZoom = React.useCallback(() => {
    setZoom(1);
    const el = viewportRef.current;
    if (el) requestAnimationFrame(() => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
  }, []);

  // ── Pinch (two-pointer) tracking ──────────────────────────────────────────
  const pointersRef = React.useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = React.useRef<{
    startDist: number;
    startZoom: number;
    focusVp: { x: number; y: number };
    focusContent: { x: number; y: number };
    target: number;
  } | null>(null);

  const midpoint = React.useCallback(() => {
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isReady) return;
      const pts = pointersRef.current;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return; // single pointer → native scroll + field taps
      const el = viewportRef.current;
      const col = pagesColRef.current;
      if (!el || !col) return;
      // Capture both pointers so their moves route here even off the fingers.
      for (const id of pts.keys()) {
        try {
          el.setPointerCapture(id);
        } catch {
          /* pointer may already be gone */
        }
      }
      const mid = midpoint();
      const vpRect = el.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      gestureRef.current = {
        startDist: dist(...([...pts.values()] as [{ x: number; y: number }, { x: number; y: number }])),
        startZoom: zoomRef.current,
        focusVp: { x: mid.x - vpRect.left, y: mid.y - vpRect.top },
        focusContent: { x: mid.x - colRect.left, y: mid.y - colRect.top },
        target: zoomRef.current,
      };
      setPinching(true);
    },
    [isReady, midpoint],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pts = pointersRef.current;
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gestureRef.current;
      if (!g || pts.size < 2) return;
      e.preventDefault();
      const d = dist(...([...pts.values()] as [{ x: number; y: number }, { x: number; y: number }]));
      const target = clamp((g.startZoom * d) / g.startDist, scale.min, scale.max);
      g.target = target;
      // Scale the committed column by the residual factor about the focal point.
      setPreview({ s: target / zoomRef.current, ox: g.focusContent.x, oy: g.focusContent.y });
    },
    [scale.min, scale.max],
  );

  const endPointer = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pts = pointersRef.current;
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      const el = viewportRef.current;
      try {
        el?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const g = gestureRef.current;
      if (g && pts.size < 2) {
        // Pinch finished: commit the settled zoom (one re-render) and clear the
        // preview transform, keeping the focal point under the fingers.
        gestureRef.current = null;
        setPinching(false);
        setPreview(null);
        applyZoom(g.target, g.focusVp, g.focusContent);
      }
    },
    [applyZoom],
  );

  // Measure the fixed CTA is no longer needed — the footer is an in-flow flex
  // child below the scroll viewport, so it never overlaps the pages.

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

  // Tap-to-jump: smooth-scroll a page to the top of the viewport. Clamped to the
  // valid range so the prev/next controls are no-ops at the ends.
  const scrollToPage = React.useCallback(
    (n: number) => {
      const target = clamp(n, 1, pageCount);
      const root = viewportRef.current;
      root
        ?.querySelector<HTMLElement>(`[data-page-number="${target}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [pageCount],
  );

  const onFieldTap = React.useCallback(
    (field: SigningPayloadField) => {
      scrollToField(field.id);
      openField(field.id);
    },
    [openField, scrollToField],
  );

  const onCta = React.useCallback(async () => {
    const next = orderedUnfilled[0];
    if (next) {
      scrollToField(next.id);
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
  }, [orderedUnfilled, scrollToField, openField, complete, completing]);

  const progress =
    total === 0
      ? '서명할 항목이 없어요.'
      : remaining === 0
        ? '모든 항목을 작성했어요.'
        : `서명할 항목 ${total}곳 중 ${total - remaining}곳을 작성했어요.`;

  // Viewer touch-action scope (kept separate from the signature pad's `touch-none`):
  //  • pinching → `none`: the two fingers are ours to scale.
  //  • zoomed   → `pan-x pan-y`: native scroll pans the enlarged pages.
  //  • fit (1×) → `pan-y`: vertical reading only; also suppresses the browser's
  //    own page pinch-zoom so our handler can start one.
  const touchAction = pinching ? 'none' : zoom > 1 ? 'pan-x pan-y' : 'pan-y';

  return (
    <main
      style={brandStyle(meta.sender.brandColor)}
      className="h-dvh-safe mx-auto flex w-full max-w-[480px] flex-col px-lg pt-xl"
    >
      <BrandingHeader sender={meta.sender} />

      <div className="mt-lg">
        <h1 className="truncate text-xl font-bold text-foreground">
          {payload?.documentTitle ?? meta.documentTitle}
        </h1>
        <p className="mt-2xs text-sm text-foreground-subtle">{progress}</p>
      </div>

      {/* Zoom/pan viewport: clips the enlarged pages and owns the pinch scope. */}
      <div className="relative mt-lg min-h-0 flex-1">
        <div
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          className="h-full overflow-auto overscroll-contain"
          style={{ touchAction }}
        >
          <div
            ref={pagesColRef}
            className="flex flex-col gap-lg pb-lg"
            style={{
              width: isReady ? displayWidth : '100%',
              transform: preview ? `scale(${preview.s})` : undefined,
              transformOrigin: preview ? `${preview.ox}px ${preview.oy}px` : undefined,
            }}
          >
            {status === 'error' ? (
              <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-xs rounded-md border border-border bg-surface-muted px-md text-center">
                <p className="text-sm text-foreground-muted">{error}</p>
              </div>
            ) : !isReady ? (
              <Skeleton className="aspect-[1/1.414] w-full" />
            ) : (
              Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
                <PdfPageView
                  key={pageNumber}
                  doc={doc}
                  pageNumber={pageNumber}
                  width={displayWidth}
                  maxCanvasWidth={maxCanvasWidth}
                  fields={fields.filter((f) => f.page === pageNumber)}
                  fieldValues={fieldValues}
                  onFieldTap={onFieldTap}
                />
              ))
            )}
          </div>
        </div>

        {/* On-screen zoom controls — a fallback for signers who can't pinch. Each
            button meets the 44×44px hit target; they float above the pages and
            clear of the bottom CTA. Hidden until the document can render. */}
        {isReady ? (
          <div className="pointer-events-none absolute bottom-md right-md flex flex-col gap-xs">
            <ZoomButton
              label="확대"
              onClick={() => stepZoom(scale.step)}
              disabled={zoom >= scale.max}
            >
              +
            </ZoomButton>
            <ZoomButton
              label="축소"
              onClick={() => stepZoom(-scale.step)}
              disabled={zoom <= scale.min}
            >
              −
            </ZoomButton>
            <ZoomButton label="원래 크기로" onClick={resetZoom} disabled={zoom === 1}>
              <span className="text-2xs font-bold">1×</span>
            </ZoomButton>
          </div>
        ) : null}

        {/* Thumb-reach page navigator — a bottom-centre floating pill showing the
            current / total page with prev·next jumps. Positioned on the viewport
            container (not the scrolling column), so it stays in the one-hand
            reach zone regardless of zoom/pan, and floats above the in-flow CTA
            (which owns the home-indicator clearance). Hidden for single-page docs
            and until the document can render. */}
        {isReady && pageCount > 1 ? (
          <div className="pointer-events-none absolute bottom-md left-1/2 flex -translate-x-1/2 items-center gap-2xs rounded-full border border-border bg-surface/95 px-2xs shadow-md backdrop-blur">
            <PageNavButton
              label="이전 페이지"
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              ‹
            </PageNavButton>
            <span
              aria-live="polite"
              className="min-w-[3.5ch] select-none text-center text-sm font-semibold tabular-nums text-foreground"
            >
              <span className="sr-only">{`전체 ${pageCount}페이지 중 `}</span>
              {currentPage}
              <span className="text-foreground-subtle">{` / ${pageCount}`}</span>
            </span>
            <PageNavButton
              label="다음 페이지"
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
            >
              ›
            </PageNavButton>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border bg-surface px-lg py-md pb-safe-cta">
        {completeError ? (
          <p role="alert" aria-live="assertive" className="mb-xs text-center text-sm text-danger">
            {completeError}
          </p>
        ) : null}
        <Button fullWidth size="lg" onClick={onCta} isLoading={completing}>
          {remaining > 0 ? SIGNER_COPY.viewerCtaContinue : SIGNER_COPY.viewerCtaComplete}
        </Button>
      </div>

      {/* The capture BottomSheet targets the field opened via the signer context. */}
      <SignatureInputSheet />
    </main>
  );
}

/** A single circular zoom control that guarantees a 44×44px touch target. */
function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-hit-target pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full',
        'border border-border bg-surface/95 text-xl font-bold text-foreground shadow-md backdrop-blur',
        'transition-transform duration-fast ease-standard active:scale-[0.94]',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
        'disabled:opacity-40 disabled:active:scale-100',
      )}
    >
      <span className="pointer-events-none leading-none">{children}</span>
    </button>
  );
}

/**
 * A prev/next control inside the page-nav pill. Shares the zoom controls' tone
 * (auxiliary, neutral) and guarantees a 44×44px touch target; the pill itself
 * carries the surface/border/shadow, so the button stays transparent.
 */
function PageNavButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-hit-target pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full',
        'text-xl font-bold text-foreground',
        'transition-transform duration-fast ease-standard active:scale-[0.94]',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
        'disabled:opacity-40 disabled:active:scale-100',
      )}
    >
      <span className="pointer-events-none leading-none">{children}</span>
    </button>
  );
}

interface PdfPageViewProps {
  doc: PdfDocument;
  pageNumber: number;
  /** Fit-to-width target in CSS px (grows with zoom). */
  width: number;
  /** Device-pixel cap on the raster (sharp up to 2× zoom, upscaled beyond). */
  maxCanvasWidth: number;
  fields: SigningPayloadField[];
  fieldValues: Record<string, SignerFieldValue>;
  onFieldTap: (field: SigningPayloadField) => void;
}

/** One PDF page rasterized fit-to-width, with its field overlay on top. */
function PdfPageView({
  doc,
  pageNumber,
  width,
  maxCanvasWidth,
  fields,
  fieldValues,
  onFieldTap,
}: PdfPageViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [pageSize, setPageSize] = React.useState<PageSize | null>(null);
  const [status, setStatus] = React.useState<LoadStatus>('loading');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    let cancelled = false;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    renderPageToCanvas(doc, pageNumber, canvas, width, { maxCanvasWidth })
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
  }, [doc, pageNumber, width, maxCanvasWidth]);

  const ready = status === 'ready' && pageSize !== null;

  return (
    <div className="relative w-full" data-page-number={pageNumber}>
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
