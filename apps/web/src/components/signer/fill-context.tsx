'use client';

/**
 * Fill flow — the flow-agnostic contract the document-reading + field-capture +
 * completion surfaces bind to.
 *
 * The OTP signer flow (`/sign/[token]`) and the link-share recipient flow
 * (`/share/[token]`) render the *same* heavy presentational components
 * (`document-viewer`, `signature-sheet`, `completion-screen`). Those screens
 * differ only in their access gate, their API endpoints, and a little copy — the
 * reading/filling/finalize experience is identical. Rather than fork them, each
 * flow builds a {@link FillContextValue} adapter and wraps the screens in a
 * {@link FillProvider}: the components consume `useFill()` and never reach for a
 * flow-specific context or API client directly.
 *
 * This is the "안전하게 파라미터화" boundary from grain-6 — the signer state
 * machine (`signer-context`) keeps owning the OTP path; the share state machine
 * (`share-context`) owns the password path; both project onto this one surface.
 */

import * as React from 'react';
import type { ClauseSummary } from '@repo/db';
import type { SignFieldType } from '@/lib/signing';
import type { CompletionArtifact } from '@/lib/completion-download';
import type { SignerSender } from '@/lib/signing';

/**
 * A value the recipient has captured for one field, reflected inline on the page
 * by the viewer. Shared verbatim by both flows (the capture UI is identical).
 */
export type FillFieldValue =
  | { type: 'SIGNATURE'; /** Captured signature as a PNG data URL. */ dataUrl: string }
  | { type: 'TEXT'; text: string; /** Optional chosen signature font. */ fontFamily?: string }
  | { type: 'DATE'; text: string };

/** One assigned field with normalized (0..1) geometry — the viewer's overlay unit. */
export interface FillField {
  id: string;
  type: SignFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Already has a server-persisted value (a resumed session). */
  filled: boolean;
}

/** The recipient's working set: document title + assigned fields. */
export interface FillPayload {
  documentTitle: string;
  pageCount: number;
  fields: FillField[];
}

/**
 * Flow-specific copy for the shared screens. The OTP flow speaks "서명"; the
 * share flow speaks "작성/제출" (the recipient may fill a name/date/address, not
 * only sign). Authored in each flow's copy catalog; the components stay neutral.
 */
export interface FillCopy {
  /** Bottom CTA when unfilled fields remain (jumps to the next one). */
  ctaContinue: string;
  /** Bottom CTA when every field is captured (finalizes). */
  ctaComplete: string;
  /** Whole-document load failure. */
  loadError: string;
  /** Per-page rasterize failure, by page number. */
  pageError: (pageNumber: number) => string;
  /** Progress line, by total + completed counts. */
  progress: (total: number, done: number) => string;
  /** Progress line when there are no fields to fill. */
  progressNone: string;
  /** Progress line when every field is done. */
  progressAllDone: string;
  /** "Tap here" affordance on an unfilled field, by type. */
  fieldAffordance: Record<SignFieldType, string>;
  /** Finalize-CTA failure fallback (when the server gives none). */
  completeError: string;
  /** The capture BottomSheet chrome (titles, mode toggles, hints, apply…). */
  sheet: SheetCopy;
  /** The completion takeover chrome. */
  done: DoneCopy;
}

export interface SheetCopy {
  title: Record<SignFieldType, string>;
  modeDraw: string;
  modeType: string;
  drawHint: string;
  typeHint: string;
  typePlaceholder: string;
  fontLabel: string;
  dateLabel: string;
  textLabel: string;
  textPlaceholder: string;
  reset: string;
  apply: string;
  saveError: string;
  /** Inline hint under the sheet title, by field type. */
  hint: (type: SignFieldType) => string;
}

export interface DoneCopy {
  title: string;
  body: string;
  documentLabel: string;
  /**
   * Heading for the contract-summary recap on the completion card (the key-clause
   * recap shown when `clauseSummary` is present). Omit-safe: the recap only
   * renders when a summary exists (graceful degradation).
   */
  summaryHeading: string;
  /** Next-step note when the whole document is now complete. */
  nextAllDone: string;
  /** Next-step note when other participants are still pending. */
  nextWaiting: string;
}

/** Optional completed-artifact download (OTP only; the share flow omits it). */
export interface FillDownload {
  onDownload: (kind: CompletionArtifact) => Promise<void>;
}

/**
 * Everything the shared reading/filling/completion screens need, projected from
 * whichever flow state machine owns the session.
 */
export interface FillContextValue {
  /** Sender identity for the branding header. */
  sender: SignerSender;
  /** Sender brand color for the `brandStyle()` hook (re-skins the subtree). */
  brandColor: string | null;
  /** Document title fallback (when the payload hasn't resolved yet). */
  documentTitle: string;
  /** The recipient's working set; null until the access gate is cleared. */
  payload: FillPayload | null;
  /**
   * AI key-clause summary for the summary-first reading screen, or `null` when
   * the document has no summary (both flows fall back to the plain original
   * viewer). Sourced from each flow's payload; the UI wiring lands in a later
   * grain.
   */
  clauseSummary: ClauseSummary | null;
  /** Captured values per field id; the viewer reflects these inline. */
  fieldValues: Record<string, FillFieldValue>;
  /** The field whose capture sheet is open (drives the BottomSheet target). */
  activeFieldId: string | null;
  /** True once finalize reports the whole document is complete. */
  documentCompleted: boolean;
  /** Absolute URL of the session-guarded PDF byte stream. */
  pdfUrl: string;
  /** Read the bearer session token for the guarded PDF / save calls. */
  loadSession: () => string | null;
  /** Persist captured field values to this flow's `fields` endpoint. */
  persistFields: (fields: { fieldId: string; value: string }[]) => Promise<void>;
  /** Open the capture sheet targeting a field. */
  openField: (fieldId: string) => void;
  /** Dismiss the capture sheet without changing any value. */
  closeField: () => void;
  /** Record a captured value for a field; the viewer reflects it inline. */
  setFieldValue: (fieldId: string, value: FillFieldValue) => void;
  /** Finalize the recipient's part (complete / submit), advancing to `done`. */
  complete: () => Promise<void>;
  /** Flow-specific copy for the shared screens. */
  copy: FillCopy;
  /** Present ⇒ the completion screen shows a download area (OTP only). */
  download?: FillDownload;
}

const FillContext = React.createContext<FillContextValue | null>(null);

export function FillProvider({
  value,
  children,
}: {
  value: FillContextValue;
  children: React.ReactNode;
}) {
  return <FillContext.Provider value={value}>{children}</FillContext.Provider>;
}

export function useFill(): FillContextValue {
  const ctx = React.useContext(FillContext);
  if (!ctx) throw new Error('useFill must be used within a FillProvider');
  return ctx;
}
