'use client';

import * as React from 'react';
import { Button, Card } from '@repo/ui';
import type { TemplateSummary } from '@/lib/templates';
import { useTranslation } from '@/components/locale-provider';
import { formatRelativeTime, type Translate } from '@/lib/relative-time';

/**
 * TemplateCard — one saved template as a card (design-spec
 * `components/template-card/base.md`). Shares the visual language of the
 * dashboard's ContractCard (icon tile + title row + muted meta line on the Card
 * surface) so the lists read as one system.
 *
 * Three shapes:
 * - **base** (default): a read-only summary in the "내 템플릿" list — no link,
 *   badges, or actions.
 * - **selectable** Variant (design-spec `components/template-card/selectable.md`):
 *   pass `onSelect` and the card becomes a full-width button with the Card's
 *   interactive hover-lift + a trailing chevron. Used by the `/contracts/new`
 *   picker to start a contract from a template. Disable it (`disabled`) while a
 *   pick is being prepared so only one prepare runs at a time.
 * - **manageable** Extension (design-spec `components/template-card/manageable.md`):
 *   pass `actions` and the summary row grows a divided action cluster —
 *   미리보기 · 이름 수정 · 삭제 (quiet ghost buttons; delete carries a subtle danger
 *   tint) on the left and the primary '이 템플릿으로 시작' on the right. Used by
 *   `/templates` so a saved layout can be previewed, renamed, deleted, or reused.
 *
 * `onSelect` and `actions` are mutually exclusive — the picker uses `onSelect`,
 * the list uses `actions`. Copy (units, ordering, a11y labels) is never owned
 * here: it comes from the `templates` translation namespace (via `useTranslation`)
 * and the caller (`selectLabel`).
 */

/** Per-card management handlers for the manageable Extension. */
export interface TemplateCardActions {
  /** Primary — reuse this template for a new contract. */
  onStart: (template: TemplateSummary) => void;
  /** Open the read-only PDF preview. */
  onPreview: (template: TemplateSummary) => void;
  /** Open the rename modal. */
  onRename: (template: TemplateSummary) => void;
  /** Open the delete-confirm modal. */
  onDelete: (template: TemplateSummary) => void;
}

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
  /**
   * When provided, the card renders the management action cluster (manageable
   * Extension). Mutually exclusive with `onSelect`.
   */
  actions?: TemplateCardActions;
}

export function TemplateCard({
  template,
  onSelect,
  selectLabel,
  disabled = false,
  actions,
}: TemplateCardProps) {
  const t = useTranslation();
  const summaryRow = (
    <>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
        <TemplateIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2xs text-left">
        <h3 className="truncate text-base font-bold text-foreground">{template.name}</h3>
        <p className="truncate text-sm text-foreground-subtle">{metaLine(template, t)}</p>
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
          {summaryRow}
        </Card>
      </button>
    );
  }

  if (actions) {
    return (
      <Card className="flex flex-col gap-md p-lg">
        <div className="flex items-center gap-md">{summaryRow}</div>
        <div
          className="flex flex-wrap items-center gap-xs border-t border-border pt-md"
          role="group"
          aria-label={t('templates.actionsLabel', { name: template.name })}
        >
          <Button variant="ghost" size="sm" onClick={() => actions.onPreview(template)}>
            {t('templates.preview')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => actions.onRename(template)}>
            {t('templates.rename')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onDelete(template)}
            className="text-danger hover:bg-danger-subtle hover:text-danger active:bg-danger-subtle"
          >
            {t('templates.delete')}
          </Button>
          <Button
            size="sm"
            onClick={() => actions.onStart(template)}
            className="ml-auto"
          >
            {t('templates.start')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex items-center gap-md p-lg">
      {summaryRow}
    </Card>
  );
}

function metaLine(template: TemplateSummary, t: Translate): string {
  const parts = [
    t('templates.metaPages', { n: template.pageCount }),
    t('templates.metaFields', { n: template.fieldCount }),
  ];
  const when = formatRelativeTime(template.createdAt, t);
  if (when) parts.push(`${when} ${t('templates.savedSuffix')}`);
  return parts.join(' · ');
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
