'use client';

/**
 * ShareLinksSection — the contract detail screen's share-link area.
 *
 * Two parts (design-spec components/contract-detail):
 *   1. The '링크로 공유' primary action — the entry point that opens the
 *      ShareLinkDialog (its settings + generation live in `share-link-dialog`).
 *   2. The link list — a summary of the contract's existing share links fetched
 *      via `lib/sharing.ts`. Each row shows its lifecycle state (사용 중 / 만료됨 /
 *      중지됨 / 제출 완료), an expiry note, a copy action, and — for still-active
 *      links — a 사용 중지(revoke) action. When the contract has no links yet, the
 *      "no links" rest state shows so the section reads as intentional.
 *
 * The list refreshes after the dialog creates a link (`onCreated`) and after a
 * revoke succeeds, so the rows always reflect the server's derived state.
 */

import * as React from 'react';
import { Button, cn } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { CONTRACT_DETAIL_COPY } from '@/lib/contract-detail';
import {
  copyToClipboard,
  expiryNote,
  listShareLinks,
  passwordTriggerLabel,
  revokeShareLink,
  SHARE_COPY,
  type ShareLink,
  type ShareLinkState,
} from '@/lib/sharing';
import { ShareLinkDialog } from './share-link-dialog';
import { ShareLinkPasswordEditor } from './share-link-password';

const COPY = CONTRACT_DETAIL_COPY.share;

export interface ShareLinksSectionProps {
  documentId: string;
  documentTitle: string;
}

export function ShareLinksSection({ documentId, documentTitle }: ShareLinksSectionProps) {
  const [shareOpen, setShareOpen] = React.useState(false);
  const [links, setLinks] = React.useState<ShareLink[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const next = await listShareLinks(documentId);
      setLinks(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : SHARE_COPY.list.loadError);
    }
  }, [documentId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Optimistic revoke: flip the row to 중지됨 the instant the owner clicks, then
   * confirm with the server. On success we refetch for the authoritative view;
   * on failure we restore the row to its prior status and rethrow so the row can
   * surface the error. Mutating only the targeted link (not a whole snapshot)
   * keeps concurrent revokes independent.
   */
  const revokeLink = React.useCallback(
    async (link: ShareLink) => {
      setLinks((cur) =>
        cur ? cur.map((l) => (l.id === link.id ? { ...l, status: 'revoked' } : l)) : cur,
      );
      try {
        await revokeShareLink(documentId, link.id);
        void refresh();
      } catch (err) {
        setLinks((cur) =>
          cur ? cur.map((l) => (l.id === link.id ? { ...l, status: link.status } : l)) : cur,
        );
        throw err;
      }
    },
    [documentId, refresh],
  );

  // Replace a row with the server's authoritative link view (e.g. after a
  // password change) so its 비밀번호 tag and status reflect the update at once.
  const applyLinkUpdate = React.useCallback((updated: ShareLink) => {
    setLinks((cur) => (cur ? cur.map((l) => (l.id === updated.id ? updated : l)) : cur));
  }, []);

  return (
    <section aria-labelledby="share-links-heading" className="flex flex-col gap-md">
      <div className="flex flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2xs">
          <h2 id="share-links-heading" className="text-lg font-bold text-foreground">
            {COPY.sectionTitle}
          </h2>
          <p className="text-sm text-foreground-subtle">{COPY.sectionHelp}</p>
        </div>
        <Button size="lg" onClick={() => setShareOpen(true)} className="shrink-0 sm:w-auto">
          <ShareIcon />
          {COPY.createButton}
        </Button>
      </div>

      {loadError ? (
        <p className="text-sm text-danger" role="alert">
          {loadError}
        </p>
      ) : null}

      {links === null ? null : links.length === 0 ? (
        <EmptyLinks />
      ) : (
        <ul className="flex flex-col gap-sm">
          {links.map((link) => (
            <ShareLinkRow
              key={link.id}
              documentId={documentId}
              link={link}
              onRevoke={revokeLink}
              onPasswordChanged={applyLinkUpdate}
            />
          ))}
        </ul>
      )}

      <ShareLinkDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        documentId={documentId}
        documentTitle={documentTitle}
        onCreated={refresh}
      />
    </section>
  );
}

/** A single share-link row: state pill + url + expiry note + copy/revoke. */
function ShareLinkRow({
  documentId,
  link,
  onRevoke,
  onPasswordChanged,
}: {
  documentId: string;
  link: ShareLink;
  onRevoke: (link: ShareLink) => Promise<void>;
  onPasswordChanged: (updated: ShareLink) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  const [pwOpen, setPwOpen] = React.useState(false);
  const pwPanelId = React.useId();
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = React.useCallback(async () => {
    try {
      await copyToClipboard(link.url);
      setCopyError(null);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(SHARE_COPY.errors.copy);
    }
  }, [link.url]);

  const revoke = React.useCallback(async () => {
    if (revoking) return;
    setRevoking(true);
    setRevokeError(null);
    try {
      // Optimistic: the section flips this row to 중지됨 immediately; we only need
      // to surface an error if the server rejects (the section rolls the row back).
      await onRevoke(link);
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : SHARE_COPY.list.revokeError);
      setRevoking(false);
    }
  }, [link, onRevoke, revoking]);

  const label = link.label ?? SHARE_COPY.result.linkLabel;
  const isActive = link.status === 'active';

  return (
    <li className="flex flex-col gap-xs rounded-md border border-border bg-surface px-md py-sm">
      <div className="flex flex-wrap items-center gap-2xs">
        <StatePill state={link.status} />
        {link.requiresPassword ? (
          <span className="inline-flex items-center gap-2xs rounded-full bg-grey-100 px-xs py-2xs text-2xs font-semibold text-foreground-subtle">
            <LockIcon />
            {SHARE_COPY.list.passwordTag}
          </span>
        ) : null}
      </div>

      <p className="min-w-0 truncate text-sm text-foreground" title={link.url}>
        {link.url}
      </p>
      {/* Only active links carry the forward-looking "…까지 열 수 있어요" note; for
          expired/revoked/completed rows the state pill already tells the story. */}
      {isActive ? <p className="text-xs text-foreground-subtle">{expiryNote(link)}</p> : null}

      <div className="mt-2xs flex flex-wrap items-center gap-xs">
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? (
            <>
              <CheckIcon />
              {SHARE_COPY.result.copied}
            </>
          ) : (
            SHARE_COPY.result.copy
          )}
        </Button>
        {isActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPwOpen((v) => !v)}
            aria-expanded={pwOpen}
            aria-controls={pwPanelId}
            aria-label={SHARE_COPY.passwordAdmin.triggerAria(label)}
          >
            {pwOpen ? SHARE_COPY.passwordAdmin.close : passwordTriggerLabel(link.requiresPassword)}
          </Button>
        ) : null}
        {isActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void revoke()}
            isLoading={revoking}
            aria-label={SHARE_COPY.list.revokeAria(label)}
            className="text-danger hover:bg-danger-subtle"
          >
            {revoking ? SHARE_COPY.list.revoking : SHARE_COPY.list.revoke}
          </Button>
        ) : null}
      </div>

      {/* Inline 비밀번호 확인·수정 panel — active links only. Mounts fresh on open
          so it always fetches the link's current password state. */}
      {isActive && pwOpen ? (
        <ShareLinkPasswordEditor
          documentId={documentId}
          link={link}
          id={pwPanelId}
          onChanged={onPasswordChanged}
        />
      ) : null}

      <div role="status" aria-live="polite" className="min-h-4">
        {copied ? (
          <span className="text-xs font-semibold text-success">{SHARE_COPY.result.copyToast}</span>
        ) : copyError ? (
          <span className="text-xs text-danger">{copyError}</span>
        ) : revokeError ? (
          <span className="text-xs text-danger" role="alert">
            {revokeError}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * StatePill — a link's lifecycle state as a pill. Hue is carried by a leading
 * dot over a tinted background while the label stays dark, mirroring
 * `StatusBadge` (color is never the only signal — the Korean label is present).
 */
const STATE_TONE: Record<ShareLinkState, { tint: string; dot: string; text: string }> = {
  active: { tint: 'bg-primary-subtle', dot: 'bg-primary', text: 'text-primary' },
  completed: { tint: 'bg-success-subtle', dot: 'bg-success', text: 'text-foreground-muted' },
  expired: { tint: 'bg-grey-100', dot: 'bg-grey-400', text: 'text-foreground-muted' },
  revoked: { tint: 'bg-grey-100', dot: 'bg-grey-300', text: 'text-foreground-subtle' },
};

function StatePill({ state }: { state: ShareLinkState }) {
  const tone = STATE_TONE[state];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2xs rounded-full px-xs py-2xs text-2xs font-semibold',
        tone.tint,
        tone.text,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      {SHARE_COPY.state[state]}
    </span>
  );
}

function EmptyLinks() {
  return (
    <div className="flex flex-col items-center gap-2xs rounded-md border border-dashed border-border bg-surface-muted px-lg py-2xl text-center">
      <LinkGlyph />
      <p className="mt-xs text-base font-semibold text-foreground">{COPY.emptyTitle}</p>
      <p className="text-sm text-foreground-subtle">{COPY.emptyBody}</p>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 animate-step-bounce" fill="none" aria-hidden="true">
      <path
        d="m4 10.5 4 4 8-9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-subtle text-primary"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
        <path
          d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
