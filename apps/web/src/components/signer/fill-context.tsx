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
import type { ContractHighlight, HighlightCategory, SignFieldType } from '@/lib/signing';
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
  /**
   * Compact progress counter for the bottom CTA ("서명 N/M 완료"), by completed +
   * total counts. Shorter than {@link progress} (a full sentence) — the CTA needs
   * a glanceable count, not prose. Only shown when there is at least one field.
   */
  progressCount: (done: number, total: number) => string;
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
  /** The collapsible full-document ("원문 보기") disclosure chrome. */
  document: DocumentDisclosureCopy;
  /** The completion takeover chrome. */
  done: DoneCopy;
}

/**
 * Chrome for the collapsible full-contract view. The full PDF is collapsed by
 * default (the pre-read summary is what the recipient sees first); this labels
 * the disclosure toggle that reveals it and the calm hint under the heading.
 */
export interface DocumentDisclosureCopy {
  /** Accessible label + heading for the collapsible original-document section. */
  sectionTitle: string;
  /** One-line hint under the heading (why the full text is folded away). */
  hint: string;
  /** Toggle label while collapsed — tapping expands the document. */
  expand: string;
  /** Toggle label while expanded — tapping collapses it again. */
  collapse: string;
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
  /** Summary-card row label: the contract's calendar date. */
  dateLabel: string;
  /** Summary-card row label: the contract amount. */
  amountLabel: string;
  /**
   * Summary-card row label for when the finalize was sealed. The OTP flow says
   * "서명 완료 시각"; the share flow says "제출 완료 시각".
   */
  signedAtLabel: string;
  /** Next-step note when the whole document is now complete. */
  nextAllDone: string;
  /** Next-step note when other participants are still pending. */
  nextWaiting: string;
  /**
   * Heading above the completion recap cards ("계약 핵심 요약"). Only shown when
   * the flow projects highlights with at least one clause (OTP flow); the share
   * flow provides it for type-completeness but never renders the recap.
   */
  summaryLabel: string;
}

/** Optional completed-artifact download (OTP only; the share flow omits it). */
export interface FillDownload {
  onDownload: (kind: CompletionArtifact) => Promise<void>;
}

/**
 * Concrete contract facts for the completion summary card, projected by the flow
 * once finalize (complete / submit) succeeds. `signedAt` is always present (the
 * server stamps it); `contractDate`/`contractAmount` are the verbatim PDF strings
 * or `null` when the contract has no machine-readable value for that fact (a
 * scanned/image-only PDF, or simply absent) — the screen omits null rows.
 */
export interface FillCompletionFacts {
  /** ISO timestamp the signature/submission was sealed. */
  signedAt: string;
  /** Contract date verbatim from the PDF ("2026년 1월 1일"), or null. */
  contractDate: string | null;
  /** Contract amount verbatim from the PDF ("5,000,000원"), or null. */
  contractAmount: string | null;
}

/**
 * Client-owned chrome for the key-clause summary (the card *content* is
 * server-authored). Bundled with the data so a flow either provides the whole
 * summary feature or omits it entirely.
 */
export interface FillHighlightsCopy {
  /** Section heading above the cards. */
  sectionTitle: string;
  /** One-line intro under the heading. */
  sectionHint: string;
  /** Category badge label, by card category. */
  categoryLabel: Record<HighlightCategory, string>;
  /** "Jump to the original text" affordance on each card. */
  sourceLink: string;
  /** Graceful line when extraction wasn't possible (not an error). */
  unavailable: string;
}

/**
 * The pre-read key-clause summary, projected by a flow that supports it. Absent
 * (`undefined`) on flows that don't (e.g. the link-share recipient), in which
 * case the viewer renders no summary. `null` means "still loading".
 */
export interface FillHighlights {
  /** False ⇒ show the graceful `copy.unavailable` fallback instead of cards. */
  available: boolean;
  clauses: ContractHighlight[];
  copy: FillHighlightsCopy;
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
  /**
   * Present ⇒ the viewer renders the key-clause summary above the document.
   * `null` while loading, `undefined` on flows without the feature. Absent on
   * the link-share flow (its recipients read the full doc, no OTP session
   * highlights endpoint), so it stays undefined and no summary shows.
   */
  highlights?: FillHighlights | null;
  /**
   * Concrete contract facts for the completion summary card, projected once
   * finalize succeeds. `undefined` before completion / on flows that don't carry
   * them, in which case the summary card shows only the document title.
   */
  completion?: FillCompletionFacts;
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
