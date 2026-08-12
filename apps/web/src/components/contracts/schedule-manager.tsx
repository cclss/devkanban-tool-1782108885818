'use client';

/**
 * ScheduleManager — the reservation-management block on a SCHEDULED contract's
 * detail screen (design-spec `content/message-schedule-manage-ui.md`).
 *
 * Shown only while the contract is 예약됨. Surfaces the reservation instant
 * (`formatScheduledSendAt`) and two actions:
 *   • 예약 변경 — opens a dialog holding the shared `SchedulePicker`, seeded with
 *     the current reservation; confirming reschedules to a new future instant.
 *   • 예약 취소 — opens a confirm dialog; confirming reverts the contract to DRAFT
 *     (작성 중).
 *
 * Presentational + local dialog state only. The async wrappers and outcome
 * normalization live in `lib/schedule-manage`; every string in `lib/schedule-copy`.
 * On a successful action the block closes its dialog and calls `onChanged`, which
 * the detail route wires to a re-fetch so the screen reflects the new state
 * (updated instant, or the exit from SCHEDULED). Server rejections render inline
 * inside the dialog that raised them.
 */

import * as React from 'react';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui';
import { SchedulePicker } from '@/components/wizard/schedule-picker';
import { SCHEDULE_MANAGE_COPY } from '@/lib/schedule-copy';
import { runCancel, runReschedule, seedScheduleValue } from '@/lib/schedule-manage';
import { type ScheduleValidity } from '@/lib/schedule-time';
import { formatScheduledSendAt } from '@/lib/todo-copy';

const COPY = SCHEDULE_MANAGE_COPY;

export interface ScheduleManagerProps {
  /** The SCHEDULED contract's id (target of the reschedule/cancel calls). */
  documentId: string;
  /** Current reservation instant (UTC ISO); may be null on a stale payload. */
  scheduledSendAt: string | null;
  /** Called after a successful reschedule/cancel so the route re-fetches detail. */
  onChanged: () => void;
}

export function ScheduleManager({ documentId, scheduledSendAt, onChanged }: ScheduleManagerProps) {
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const when = scheduledSendAt ? formatScheduledSendAt(scheduledSendAt) : '';

  return (
    <Card className="flex flex-col gap-md p-lg">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-base font-bold text-foreground">{COPY.section.title}</h2>
        {when ? (
          <div className="flex flex-col gap-2xs">
            <span className="text-sm text-foreground-subtle">{COPY.section.instantLabel}</span>
            <span className="text-base font-semibold text-foreground">{when}</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-sm">
        <Button variant="secondary" onClick={() => setRescheduleOpen(true)}>
          {COPY.action.reschedule}
        </Button>
        <Button variant="ghost" onClick={() => setCancelOpen(true)}>
          {COPY.action.cancel}
        </Button>
      </div>

      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        documentId={documentId}
        scheduledSendAt={scheduledSendAt}
        onChanged={onChanged}
      />
      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        documentId={documentId}
        onChanged={onChanged}
      />
    </Card>
  );
}

function RescheduleDialog({
  open,
  onOpenChange,
  documentId,
  scheduledSendAt,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  scheduledSendAt: string | null;
  onChanged: () => void;
}) {
  // Freeze one instant per open so the picker's `min`, seed, and validation share
  // a clock; re-seed from the current reservation each time the dialog opens.
  const [now, setNow] = React.useState<Date | null>(null);
  const [value, setValue] = React.useState('');
  const [validity, setValidity] = React.useState<ScheduleValidity | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const mount = new Date();
    setNow(mount);
    setValue(seedScheduleValue(scheduledSendAt, mount));
    setValidity(null);
    setError(null);
    setBusy(false);
  }, [open, scheduledSendAt]);

  const iso = validity?.valid === true ? validity.iso : null;

  const handleConfirm = async () => {
    if (!iso || busy) return;
    setBusy(true);
    setError(null);
    const result = await runReschedule(documentId, iso);
    if (result.ok) {
      onOpenChange(false);
      onChanged();
      return;
    }
    setError(result.message);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{COPY.rescheduleDialog.title}</DialogTitle>
        </DialogHeader>

        <SchedulePicker
          value={value}
          onChange={setValue}
          onValidityChange={setValidity}
          now={now ?? undefined}
          showError={Boolean(validity && !validity.valid)}
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {COPY.rescheduleDialog.dismiss}
          </Button>
          <Button isLoading={busy} disabled={!iso} onClick={() => void handleConfirm()}>
            {busy ? COPY.rescheduleDialog.rescheduling : COPY.rescheduleDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  documentId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError(null);
  }, [open]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await runCancel(documentId);
    if (result.ok) {
      onOpenChange(false);
      onChanged();
      return;
    }
    setError(result.message);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{COPY.cancelDialog.title}</DialogTitle>
          <DialogDescription>{COPY.cancelDialog.description}</DialogDescription>
        </DialogHeader>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {COPY.cancelDialog.dismiss}
          </Button>
          <Button variant="danger" isLoading={busy} onClick={() => void handleConfirm()}>
            {busy ? COPY.cancelDialog.cancelling : COPY.cancelDialog.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
