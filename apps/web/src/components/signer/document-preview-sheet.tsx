'use client';

/**
 * DocumentPreviewSheet — the returnable, read-only full-document overlay (M2
 * grain-4).
 *
 * The clause stack is an auxiliary reminder; the legal effect stays with the
 * source document, which the signer must be able to reach *at any time*. The
 * collapsed '전체 원문 보기' trigger opens this overlay — the same contract PDF
 * the signing viewer renders, but read-only: no field overlays, no signature
 * CTA. It's a modal on top of the cards (`state.previewOpen`), so dismissing it
 * (X / overlay tap / ESC) returns the signer to the very card they were on — the
 * phase never changes.
 *
 * Rendering reuses the existing pdfjs path (`loadPdfFromUrl` + `renderPageToCanvas`
 * from `@/lib/pdf`) and the signing viewer's per-page visuals (fit-to-width canvas,
 * skeleton shimmer, friendly per-page error) — no new render engine. The shell is
 * the shared `Sheet side="bottom"`, so the focus trap, scroll lock, dismiss and
 * safe-area bottom padding all come from the primitive (same pattern as the
 * signature capture sheet); the document scrolls inside a full-height panel.
 *
 * Only mounted from the `clauses` phase, so its PDF handle never overlaps the
 * signing viewer's (a different phase). The non-READY fallback — which routes
 * straight to `viewing` — never reaches this overlay, so that path is untouched.
 */

import * as React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton, cn } from '@repo/ui';
import {
  getSignerSession,
  signerPdfUrl,
  SIGNER_COPY,
} from '@/lib/signing';
import {
  loadPdfFromUrl,
  renderPageToCanvas,
  isRenderCancelled,
  PdfRenderError,
  type PdfDocument,
} from '@/lib/pdf';
import { useSigner } from './signer-context';

type LoadStatus = 'loading' | 'ready' | 'error';

export function DocumentPreviewSheet() {
  const { state, closePreview } = useSigner();

  // The `SheetTitle` is this dialog's accessible name (Radix labels the overlay by
  // it). The document name is virtually always present here, but guard the empty
  // case so the overlay is never announced as an unlabeled dialog — fall back to
  // the trigger's own '전체 원문 보기' label (existing copy, no new string). `||`
  // (not `??`) so an empty-string title is caught too.
  const documentTitle =
    state.payload?.documentTitle ?? state.meta?.documentTitle ?? '';
  const title = documentTitle || SIGNER_COPY.clause.viewFull;

  return (
    <Sheet
      open={state.previewOpen}
      onOpenChange={(open) => {
        if (!open) closePreview();
      }}
    >
      {/*
        Full-height reader. Mobile padding is trimmed to `px-lg pt-lg` and restored
        at `sm:` (signature-sheet.md decisions 2–3); the primitive's safe-area
        bottom padding is preserved (never reset via a `p-*` shorthand). No
        description → suppress Radix's aria-describedby lookup.
      */}
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="flex h-[calc(100dvh-2rem)] flex-col px-lg pt-lg sm:px-xl sm:pt-xl"
      >
        <SheetHeader className="pb-sm">
          <SheetTitle className="truncate pr-9">{title}</SheetTitle>
        </SheetHeader>

        {/* Mount (and load) the PDF only while open — dismiss disposes it. */}
        {state.previewOpen ? <PreviewBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** Streams the read-only PDF and renders every page fit-to-width, in a scroll pane. */
function PreviewBody() {
  const { token } = useSigner();
  const session = React.useMemo(() => getSignerSession(token), [token]);

  const [doc, setDoc] = React.useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [status, setStatus] = React.useState<LoadStatus>('loading');
  const [error, setError] = React.useState<string>(SIGNER_COPY.viewerLoadError);

  // Open the streamed PDF once for this overlay; dispose on close/unmount. Mirrors
  // the signing viewer's loader, but this handle is scoped to the overlay's life.
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

  // Measure the scroll pane so each page rasterizes exactly fit-to-width.
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

  return (
    <div ref={pagesRef} className="flex flex-1 flex-col gap-lg overflow-y-auto pb-lg">
      {status === 'error' ? (
        <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-xs rounded-md border border-border bg-surface-muted px-md text-center">
          <p className="text-sm text-foreground-muted">{error}</p>
        </div>
      ) : status === 'loading' || !doc || pageWidth === 0 ? (
        <Skeleton className="aspect-[1/1.414] w-full" />
      ) : (
        Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
          <PreviewPage key={pageNumber} doc={doc} pageNumber={pageNumber} width={pageWidth} />
        ))
      )}
    </div>
  );
}

/** One PDF page rasterized fit-to-width — read-only, no field overlay. */
function PreviewPage({
  doc,
  pageNumber,
  width,
}: {
  doc: PdfDocument;
  pageNumber: number;
  width: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = React.useState<LoadStatus>('loading');

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    let cancelled = false;
    setStatus('loading');
    renderPageToCanvas(doc, pageNumber, canvas, width)
      .then(() => {
        if (cancelled) return;
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

  const ready = status === 'ready';

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
    </div>
  );
}
