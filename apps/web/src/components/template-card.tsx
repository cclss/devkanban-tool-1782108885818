'use client';

import * as React from 'react';
import { Card } from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { TEMPLATE_META_COPY } from '@/lib/templates-copy';

/**
 * TemplateCard — one saved template as a read-only card in the "내 템플릿" list
 * (design-spec `components/template-card/base.md`). Shares the visual language of
 * the dashboard's ContractCard (icon tile + title row + muted meta line on the
 * Card surface) so the two lists read as one system, but this card is a plain
 * static summary: no link, no status/urgency badges, no inline actions. Loading
 * a template into the wizard and rename/delete/preview are later grains, so the
 * card intentionally carries no affordance yet.
 *
 * Copy (units, ordering) is never owned here — it comes from `lib/templates-copy.ts`.
 */
export interface TemplateCardProps {
  template: TemplateSummary;
}

export function TemplateCard({ template }: TemplateCardProps) {
  return (
    <Card className="flex items-center gap-md p-lg">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <TemplateIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <h3 className="truncate text-base font-bold text-foreground">{template.name}</h3>
        <p className="truncate text-sm text-foreground-subtle">{metaLine(template)}</p>
      </div>
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
