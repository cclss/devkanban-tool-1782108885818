'use client';

/**
 * ShareLinkDialog — the '링크로 공유' settings modal (design-spec
 * `components/share-link-dialog/base.md`, copy `messaging/share-link.md`).
 *
 * One modal, one task: the sender picks access settings (유효기간 단일 선택 +
 * 비밀번호 보호), generates a unique open/fill link, then copies it — all on the
 * same surface. The settings/generate/result flow lives in the shared
 * `ShareLinkBody`; this container only wraps it in `@repo/ui` Dialog (focus trap,
 * scroll lock, Esc/overlay dismiss, accessible title/description). The same body
 * is reused by the create wizard's link step, so the two entry points stay in
 * lockstep.
 *
 * Security: the password lives only in the body's state and the create request
 * body. It is never persisted, logged, or rendered after generation — the server
 * returns only `requiresPassword`.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';
import { SHARE_COPY } from '@/lib/sharing';
import { ShareLinkBody } from './share-link-body';

const COPY = SHARE_COPY;

export interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The contract these links belong to. */
  documentId: string;
  documentTitle: string;
  /** Invoked after a link is successfully created, so the list can refresh. */
  onCreated?: () => void;
}

export function ShareLinkDialog({
  open,
  onOpenChange,
  documentId,
  onCreated,
}: ShareLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{COPY.header.title}</DialogTitle>
          <DialogDescription>{COPY.header.description}</DialogDescription>
        </DialogHeader>

        {/* Remount the body each time the modal opens so it starts at the
            configuring phase with fresh, empty fields (no stale password). */}
        {open ? <ShareLinkBody documentId={documentId} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}
