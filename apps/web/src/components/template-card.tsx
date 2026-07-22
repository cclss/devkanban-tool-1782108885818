'use client';

import * as React from 'react';
import { Card } from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { TEMPLATE_META_COPY } from '@/lib/templates-copy';

/**
 * TemplateCard — one saved template as a card (design-spec
 * `components/template-card/base.md`). Shares the visual language of the
 * dashboard's ContractCard (icon tile + title row + muted meta line on the Card
 * surface) so the lists read as one system.
 *
 * Two shapes:
 * - **base** (default): a read-only summary in the "내 템플릿" list — no link,
 *   badges, or actions.
 * - **selectable** Variant (design-spec `components/template-card/selectable.md`):
 *   pass `onSelect` and the card becomes a full-width button with the Card's
 *   interactive hover-lift + a trailing chevron. Used by the `/contracts/new`
 *   picker to start a contract from a template. Disable it (`disabled`) while a
 *   pick is being prepared so only one prepare runs at a time.
 *
 * Copy (units, ordering, a11y label) is never owned here — it comes from
 * `lib/templates-copy.ts` (meta) and the caller (`selectLabel`).
 */
export interface TemplateCardProps {
  template: TemplateSummary;
  /**
   * When provided, the card renders as a selectable button (picker Variant).
   * Omit for the read-only list card.
   */
  onSelect?: (template: TemplateSummary) => void;
  /** Accessible name for the select action (required with `onSelect`). */
  selectLabel?: string;
  /** Block selection while another template is being prepared. */
  disabled?: boolean;
}

export function TemplateCard({ template, onSelect, selectLabel, disabled = false }: TemplateCardProps) {
  const body = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <TemplateIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs text-left">
        <h3 className="truncate text-base font-bold text-foreground">{template.name}</h3>
        <p className="truncate text-sm text-foreground-subtle">{metaLine(template)}</p>
      </div>
      {onSelect ? <ChevronIcon /> : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(template)}
        disabled={disabled}
        aria-label={selectLabel}
        className="block w-full rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus disabled:cursor-default disabled:opacity-60"
      >
        <Card interactive className="flex items-center gap-md p-lg">
          {body}
        </Card>
      </button>
    );
  }

  return (
    <Card className="flex items-center gap-md p-lg">
      {body}
    </Card>
  );
}

function metaLine(template: TemplateSummary): string {
  const parts = [
    TEMPLATE_META_COPY.pages(template.pageCount),
    TEMPLATE_META_COPY.fields(template.fieldCount),
  ];
  const when = formatRelative(template.createdAt);
  if (when) parts.push(`${when} ${TEMPLATE_META_COPY.savedSuffix}`);
  return parts.join(' · ');
}

/**
 * Relative "saved" time in the same voice as the contract list (방금 전 / N분 전
 * / N시간 전 / N일 전, then an absolute YYYY.MM.DD past a week). Mirrors
 * ContractCard's formatRelative so both lists tell time identically.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(then);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Trailing entry affordance for the selectable Variant (mirrors ContractCard). */
function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-grey-400" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
