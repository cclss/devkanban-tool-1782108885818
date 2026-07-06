'use client';

/**
 * Wizard step 3 — recipients ("받는 분").
 *
 * The sender lists the people who will sign, *in signing order*, and assigns each
 * placed field to one of them. Order is the list order: dragging a row up makes
 * that person sign first. Because fields reference a signer by 0-based index
 * (see `lib/recipients.ts`), every reorder/remove here also remaps the field
 * assignments through the pure helpers — the component never touches index math
 * by hand.
 *
 * Validation is inline and forgiving in tone (해요체, "다시 확인해 주세요"): an
 * email error shows once its field has been touched, or once the user tries to
 * advance with an invalid list. The shell's "다음" button stays locked until
 * `recipientsComplete` passes (wired through `canProceed`).
 *
 * Sending itself is grain-9 — this step only owns input + wizard state.
 */

import * as React from 'react';
import { Button, Field, Input, cn } from '@repo/ui';
import { FIELD_TYPE_META } from '@/lib/field-geometry';
import {
  MAX_NAME_LENGTH,
  MAX_RECIPIENTS,
  autoAssignFields,
  createRecipient,
  moveIndexMap,
  moveRecipient,
  recipientLabel,
  remapFieldRecipients,
  removeIndexMap,
  validateRecipients,
} from '@/lib/recipients';
import { useWizard, type RecipientDraft, type SignFieldDraft } from './wizard-context';

export function RecipientsStep() {
  const { state, dispatch } = useWizard();
  const { recipients, fields } = state;

  // Show an email error once its field loses focus. Until then a freshly added,
  // never-touched row stays quiet — the shell's "다음" gate already blocks
  // advancing while the list is invalid, so we don't nag pre-emptively.
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set());
  // Ids mid leave-animation; removed from state only when the collapse ends.
  const [leaving, setLeaving] = React.useState<Set<string>>(() => new Set());

  const errors = React.useMemo(() => validateRecipients(recipients), [recipients]);

  const setRecipients = React.useCallback(
    (next: RecipientDraft[]) => dispatch({ type: 'SET_RECIPIENTS', recipients: next }),
    [dispatch],
  );
  const setFields = React.useCallback(
    (next: SignFieldDraft[]) => dispatch({ type: 'SET_FIELDS', fields: next }),
    [dispatch],
  );

  const atMax = recipients.length >= MAX_RECIPIENTS;

  const addRecipient = React.useCallback(() => {
    if (recipients.length >= MAX_RECIPIENTS) return;
    const next = [...recipients, createRecipient()];
    setRecipients(next);
    // First recipient added → home any orphaned fields onto them.
    setFields(autoAssignFields(fields, next.length));
  }, [recipients, fields, setRecipients, setFields]);

  const updateRecipient = React.useCallback(
    (id: string, patch: Partial<Pick<RecipientDraft, 'email' | 'name'>>) => {
      setRecipients(recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [recipients, setRecipients],
  );

  // Actually remove the recipient + remap field assignments. Runs after the
  // row's collapse animation finishes so the list motion stays smooth.
  const commitRemove = React.useCallback(
    (id: string) => {
      const index = recipients.findIndex((r) => r.id === id);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (index < 0) return;
      const nextRecipients = recipients.filter((r) => r.id !== id);
      const remapped = remapFieldRecipients(fields, removeIndexMap(recipients.length, index));
      setRecipients(nextRecipients);
      setFields(autoAssignFields(remapped, nextRecipients.length));
    },
    [recipients, fields, setRecipients, setFields],
  );

  const requestRemove = React.useCallback((id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
  }, []);

  const move = React.useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= recipients.length) return;
      setRecipients(moveRecipient(recipients, from, to));
      setFields(remapFieldRecipients(fields, moveIndexMap(recipients.length, from, to)));
    },
    [recipients, fields, setRecipients, setFields],
  );

  const markTouched = React.useCallback((id: string) => {
    setTouched((prev) => new Set(prev).add(id));
  }, []);

  const assignField = React.useCallback(
    (fieldId: string, recipientIndex: number) => {
      setFields(fields.map((f) => (f.id === fieldId ? { ...f, recipientIndex } : f)));
    },
    [fields, setFields],
  );

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">받는 분을 입력해 주세요</h2>
        <p className="text-sm text-foreground-subtle">
          서명할 분의 이름과 이메일을 서명 받을 순서대로 추가하세요.
        </p>
      </div>

      {recipients.length === 0 ? (
        <EmptyRecipients onAdd={addRecipient} />
      ) : (
        <ul className="flex flex-col gap-sm">
          {recipients.map((recipient, index) => (
            <RecipientRow
              key={recipient.id}
              recipient={recipient}
              index={index}
              total={recipients.length}
              error={touched.has(recipient.id) ? errors[recipient.id]?.email : undefined}
              leaving={leaving.has(recipient.id)}
              onChange={updateRecipient}
              onBlurEmail={() => markTouched(recipient.id)}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => requestRemove(recipient.id)}
              onLeaveEnd={() => commitRemove(recipient.id)}
            />
          ))}
        </ul>
      )}

      {recipients.length > 0 ? (
        <div className="flex flex-col gap-2xs">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={addRecipient}
            disabled={atMax}
            className="self-start"
          >
            <PlusIcon />
            받는 분 추가
          </Button>
          {atMax ? (
            <p className="text-xs text-foreground-subtle">
              받는 분은 최대 {MAX_RECIPIENTS}명까지 추가할 수 있어요.
            </p>
          ) : null}
        </div>
      ) : null}

      {recipients.length > 0 && fields.length > 0 ? (
        <FieldAssignments
          fields={fields}
          recipients={recipients}
          onAssign={assignField}
        />
      ) : null}
    </div>
  );
}

interface RecipientRowProps {
  recipient: RecipientDraft;
  index: number;
  total: number;
  error?: string;
  leaving: boolean;
  onChange: (id: string, patch: Partial<Pick<RecipientDraft, 'email' | 'name'>>) => void;
  onBlurEmail: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onLeaveEnd: () => void;
}

function RecipientRow({
  recipient,
  index,
  total,
  error,
  leaving,
  onChange,
  onBlurEmail,
  onMoveUp,
  onMoveDown,
  onRemove,
  onLeaveEnd,
}: RecipientRowProps) {
  const nameId = `recipient-${recipient.id}-name`;
  const emailId = `recipient-${recipient.id}-email`;
  const fired = React.useRef(false);

  // Fallback so the row is never stranded if the collapse transition doesn't
  // fire (e.g. zero-duration under reduced motion in some engines).
  React.useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => {
      if (!fired.current) {
        fired.current = true;
        onLeaveEnd();
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [leaving, onLeaveEnd]);

  return (
    <li
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-base ease-standard',
        leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        !leaving && 'animate-fade-in-up',
      )}
      onTransitionEnd={(e) => {
        if (
          leaving &&
          e.target === e.currentTarget &&
          e.propertyName === 'grid-template-rows' &&
          !fired.current
        ) {
          fired.current = true;
          onLeaveEnd();
        }
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex items-start gap-sm rounded-lg border border-border bg-surface p-md shadow-xs">
          {/* Signing-order badge */}
          <span
            className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-sm font-bold text-primary tabular-nums"
            aria-label={`서명 순서 ${index + 1}번째`}
          >
            {index + 1}
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-xs sm:flex-row">
            <Field
              label="이름"
              htmlFor={nameId}
              className="sm:w-[36%]"
            >
              <Input
                id={nameId}
                value={recipient.name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="홍길동"
                autoComplete="name"
                onChange={(e) => onChange(recipient.id, { name: e.target.value })}
              />
            </Field>
            <Field
              label="이메일"
              htmlFor={emailId}
              error={error}
              required
              className="flex-1"
            >
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                value={recipient.email}
                placeholder="name@example.com"
                autoComplete="off"
                invalid={Boolean(error)}
                aria-describedby={error ? `${emailId}-message` : undefined}
                onChange={(e) => onChange(recipient.id, { email: e.target.value })}
                onBlur={onBlurEmail}
              />
            </Field>
          </div>

          {/* Reorder + remove controls */}
          <div className="mt-1 flex shrink-0 items-center gap-2xs">
            <IconButton
              label={`${recipientLabel(recipient, index)} 위로 이동`}
              disabled={index === 0}
              onClick={onMoveUp}
            >
              <ArrowIcon dir="up" />
            </IconButton>
            <IconButton
              label={`${recipientLabel(recipient, index)} 아래로 이동`}
              disabled={index === total - 1}
              onClick={onMoveDown}
            >
              <ArrowIcon dir="down" />
            </IconButton>
            <IconButton
              label={`${recipientLabel(recipient, index)} 삭제`}
              onClick={onRemove}
              tone="danger"
            >
              <TrashIcon />
            </IconButton>
          </div>
        </div>
      </div>
    </li>
  );
}

function FieldAssignments({
  fields,
  recipients,
  onAssign,
}: {
  fields: SignFieldDraft[];
  recipients: RecipientDraft[];
  onAssign: (fieldId: string, recipientIndex: number) => void;
}) {
  // Stable reading order: by page, then keep placement order within a page.
  const ordered = React.useMemo(
    () =>
      fields
        .map((f, i) => ({ f, i }))
        .sort((a, b) => a.f.page - b.f.page || a.i - b.i)
        .map(({ f }) => f),
    [fields],
  );

  return (
    <section className="flex flex-col gap-sm rounded-lg border border-border bg-surface-muted p-md">
      <div className="flex flex-col gap-2xs">
        <h3 className="text-base font-bold text-foreground">필드 담당자</h3>
        <p className="text-sm text-foreground-subtle">
          각 서명 필드를 어떤 받는 분이 작성할지 지정하세요.
        </p>
      </div>

      <ul className="flex flex-col gap-xs">
        {ordered.map((field) => {
          const meta = FIELD_TYPE_META[field.type];
          const selectId = `assign-${field.id}`;
          return (
            <li
              key={field.id}
              className="flex items-center justify-between gap-sm rounded-md border border-border bg-surface px-sm py-2xs"
            >
              <span className="flex items-center gap-xs text-sm font-medium text-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary-subtle text-primary">
                  <FieldGlyph type={field.type} />
                </span>
                {meta.label} 필드 · {field.page}페이지
              </span>
              <select
                id={selectId}
                aria-label={`${meta.label} 필드 담당자 선택`}
                value={field.recipientIndex ?? 0}
                onChange={(e) => onAssign(field.id, Number(e.target.value))}
                className={cn(
                  'h-9 rounded-md border border-border bg-surface px-sm text-sm font-medium text-foreground',
                  'transition-[border-color,box-shadow] duration-fast ease-standard',
                  'focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus',
                )}
              >
                {recipients.map((r, i) => (
                  <option key={r.id} value={i}>
                    {i + 1}. {recipientLabel(r, i)}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmptyRecipients({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-md rounded-lg border border-dashed border-border-strong bg-surface-muted px-md py-3xl text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <PeopleIcon />
      </span>
      <div className="flex flex-col gap-2xs">
        <h3 className="text-lg font-bold text-foreground">아직 받는 분이 없어요</h3>
        <p className="max-w-[420px] text-sm text-foreground-subtle">
          서명을 받을 분을 추가해 주세요. 추가한 순서대로 서명 요청이 전달돼요.
        </p>
      </div>
      <Button type="button" size="md" onClick={onAdd}>
        <PlusIcon />
        받는 분 추가
      </Button>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  tone = 'default',
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-sm text-foreground-muted',
        'transition-[transform,color,background-color] duration-fast ease-standard active:scale-[0.94]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        'disabled:cursor-not-allowed disabled:opacity-30',
        tone === 'danger'
          ? 'hover:bg-danger/10 hover:text-danger'
          : 'hover:bg-grey-100 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function ArrowIcon({ dir }: { dir: 'up' | 'down' }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d={dir === 'up' ? 'M10 15V5M5 10l5-5 5 5' : 'M10 5v10M5 10l5 5 5-5'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m2 0v9a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 15V6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FieldGlyph({ type }: { type: SignFieldDraft['type'] }) {
  if (type === 'SIGNATURE') {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M2 12c2-1 3-7 5-7s1 5 3 5 2-3 4-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'DATE') {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4 4h8M8 4v8M6.5 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
