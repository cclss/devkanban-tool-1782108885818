'use client';

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';
import { AiSuggestionBadge } from '@/components/ai/ai-suggestion-badge';

/**
 * UpgradeDialog — the shared, workflow-preserving surface that presents the
 * plan-upgrade value + guidance (design-spec component `upgrade-dialog`).
 *
 * It is a modal built on `@repo/ui` Dialog, opened *over* the current screen so
 * the caller's state is never destroyed — the dashboard opens it in place, and
 * the editor opens it above the field-placement wizard so a sender's placed
 * fields survive. Billing is out of scope, so this surface only communicates the
 * upgrade's value and a calm "coming soon" — it never routes to a checkout.
 *
 * One structure, two tones (all copy is supplied by the caller; this component
 * owns none of the words):
 *   • neutral — the dashboard plan card's upgrade guidance.
 *   • ai      — the editor's premium-AI upgrade path. Adds the premium-AI visual
 *               language: a solid `AiSuggestionBadge` Mark over the violet
 *               `ai-accent` tint, so the surface reads as "our product's AI".
 */
export interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visual language: neutral plan surface, or the premium-AI accent. */
  tone?: 'neutral' | 'ai';
  /** Value-first headline (leads with the unlocked value). */
  title: string;
  /** Value + guidance body (billing is out of scope — a calm "coming soon"). */
  description: string;
  /** Acknowledge / close label. */
  ackLabel?: string;
}

export function UpgradeDialog({
  open,
  onOpenChange,
  tone = 'neutral',
  title,
  description,
  ackLabel = '알겠어요',
}: UpgradeDialogProps) {
  const isAi = tone === 'ai';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {isAi ? <AiSuggestionBadge tone="solid" className="self-start" /> : null}
          <DialogTitle className={isAi ? 'text-ai-strong' : undefined}>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{ackLabel}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
