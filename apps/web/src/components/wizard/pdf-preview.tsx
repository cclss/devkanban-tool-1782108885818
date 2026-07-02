'use client';

/**
 * First-page preview of an uploaded document.
 *
 * Renders page 1 into a <canvas> via `pdfjs-dist` (lib/pdf.ts), showing a
 * shimmering skeleton while the document parses and a guard message if it can't
 * be read. The page count is reported up so the wizard can show "{n}페이지".
 *
 * The `source` is the local File for a PDF upload, or the server's converted
 * PDF (a DOCX upload) — the preview is identical either way.
 */

import * as React from 'react';
import { Skeleton, cn } from '@repo/ui';
import { renderFirstPage, PdfRenderError, type PdfSource } from '@/lib/pdf';

interface PdfPreviewProps {
  source: PdfSource;
  onPageCount?: (pageCount: number) => void;
  className?: string;
}

type Status = 'loading' | 'ready' | 'error';

export function PdfPreview({ source, onPageCount, className }: PdfPreviewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = React.useState<Status>('loading');
  const [error, setError] = React.useState<string | null>(null);

  // Keep the latest callback in a ref so re-renders don't re-trigger the effect.
  const onPageCountRef = React.useRef(onPageCount);
  React.useEffect(() => {
    onPageCountRef.current = onPageCount;
  }, [onPageCount]);

  React.useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    setStatus('loading');
    setError(null);
    const maxWidth = Math.min(container.clientWidth || 560, 720);

    renderFirstPage(source, canvas, maxWidth)
      .then((size) => {
        if (cancelled) return;
        onPageCountRef.current?.(size.pageCount);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof PdfRenderError
            ? err.message
            : 'PDF를 읽을 수 없어요. 파일이 손상되지 않았는지 확인해 주세요.',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {status === 'loading' ? (
        <Skeleton className="aspect-[1/1.414] w-full" />
      ) : null}

      {status === 'error' ? (
        <div className="flex aspect-[1/1.414] w-full flex-col items-center justify-center gap-xs rounded-md border border-border bg-surface-muted px-md text-center">
          <PdfBrokenIcon />
          <p className="text-sm text-foreground-muted">{error}</p>
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="업로드한 문서 첫 페이지 미리보기"
        className={cn(
          'mx-auto block rounded-md border border-border shadow-sm',
          status === 'ready' ? 'animate-fade-in' : 'hidden',
        )}
      />
    </div>
  );
}

function PdfBrokenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-grey-400" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m9.5 12 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
