'use client';

/**
 * ShareLinkDialog — the '링크로 공유' modal (design-spec
 * `components/share-link-dialog/base.md`).
 *
 * grain-4 owns only the modal *container* and entry seam: it opens from the
 * detail screen's '링크로 공유' button and renders the spec header (title +
 * supporting line). The settings body — validity preset selector, password
 * toggle/field, "링크 만들기" generation, and the post-generation link + copy
 * area — is filled by grain-5 together with `lib/sharing.ts` (the share API
 * wrapper). The `onCreated` callback lets grain-5 notify the section to refresh
 * its link list after a link is made.
 *
 * The container reuses `@repo/ui` Dialog, which provides the focus trap, scroll
 * lock, Esc/overlay dismiss, and accessible labelling (title + description).
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';

export interface ShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The contract these links belong to (used by grain-5's create call). */
  documentId: string;
  documentTitle: string;
  /** grain-5: invoked after a link is successfully created, to refresh the list. */
  onCreated?: () => void;
}

export function ShareLinkDialog({ open, onOpenChange }: ShareLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>링크로 공유하기</DialogTitle>
          <DialogDescription>
            링크를 받은 사람이 계약서를 열람하고 작성할 수 있어요.
          </DialogDescription>
        </DialogHeader>

        {/*
          grain-5 fills this region (design-spec components/share-link-dialog):
          유효기간 프리셋 단일 선택 · 비밀번호 보호 토글/입력 · '링크 만들기' 생성 버튼 ·
          생성 후 '공유 링크' + 복사 버튼/확인 피드백 · 만료 안내 라인.
          API 호출은 grain-5의 lib/sharing.ts에 위임한다.
        */}
      </DialogContent>
    </Dialog>
  );
}
