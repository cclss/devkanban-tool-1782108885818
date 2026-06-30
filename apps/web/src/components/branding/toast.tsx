'use client';

/**
 * Toast — a transient, bottom-anchored status message for save/upload results.
 *
 * Toss-tone feedback in an `aria-live` region so screen readers announce the
 * outcome without moving focus. A single toast at a time (the branding screen
 * only ever reports the latest action); a new message replaces the previous one
 * and resets its auto-dismiss timer. Enters with the token-timed `fade-in-up`
 * keyframe, which collapses to a static end-state under reduced motion.
 *
 * Visual values come from design tokens only (success/danger subtle surfaces,
 * spacing, radius, shadow) — no raw values.
 */

import * as React from 'react';
import { cn } from '@repo/ui';

export type ToastTone = 'success' | 'error';

export interface ToastMessage {
  /** Bumped per emit so re-showing the same text restarts the timer. */
  id: number;
  tone: ToastTone;
  message: string;
}

const AUTO_DISMISS_MS = 4000;

/** Imperative toast controller: `toast` is the live message, `notify` emits one. */
export function useToast(): {
  toast: ToastMessage | null;
  notify: (tone: ToastTone, message: string) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = React.useState<ToastMessage | null>(null);
  const seq = React.useRef(0);
  const notify = React.useCallback((tone: ToastTone, message: string) => {
    seq.current += 1;
    setToast({ id: seq.current, tone, message });
  }, []);
  const dismiss = React.useCallback(() => setToast(null), []);
  return { toast, notify, dismiss };
}

export function ToastViewport({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-xl z-50 flex justify-center px-md"
      // Errors interrupt; successes wait their turn.
      aria-live={toast?.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast ? (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-center gap-sm rounded-md border px-md py-sm shadow-lg',
            'animate-fade-in-up',
            toast.tone === 'success'
              ? 'border-success bg-success-subtle text-foreground'
              : 'border-danger bg-danger-subtle text-foreground',
          )}
        >
          <ToastIcon tone={toast.tone} />
          <span className="text-sm font-semibold">{toast.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  return tone === 'success' ? (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-success" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 10.5 9 13l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-danger" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v5M10 13.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
