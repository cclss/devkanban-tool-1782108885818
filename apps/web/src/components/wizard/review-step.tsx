'use client';

/**
 * Wizard step 4 — review & send ("발송 검토").
 *
 * The last step has two faces:
 *
 *   1. Review summary — a read-back of what's about to go out (document, placed
 *      fields, recipients in signing order) plus this step's own 발송 CTA. The
 *      shell deliberately leaves its footer-right empty here so the send button
 *      lives with the content it confirms.
 *   2. Success — the celebratory takeover shown once the dispatch lands:
 *      "계약 발송이 완료되었습니다!" with the SuccessCheck stroke-draw + a Confetti
 *      burst (pure-CSS, reduced-motion-safe) and a staggered text fade-in.
 *
 * Sending is two ordered calls (save fields → send); see `lib/send.ts`. On
 * failure we surface the server's Korean message and let the user retry; a 401
 * means the session lapsed, so we bounce to /login. On success we stash the
 * just-sent summary via `writeSentSignal` so the dashboard shows it as '진행 중'
 * the instant we route back.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button, Confetti, SuccessCheck } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { writeSentSignal, type DocumentSummary } from '@/lib/documents';
import { FIELD_TYPE_META, FIELD_TYPES, type SignFieldType } from '@/lib/field-geometry';
import { recipientLabel } from '@/lib/recipients';
import { saveFields, sendContract } from '@/lib/send';
import { useWizard, type RecipientDraft, type SignFieldDraft } from './wizard-context';

const COPY = {
  title: '발송 전 확인해 주세요',
  subhead: '아래 내용으로 서명 요청을 보낼게요. 맞는지 확인해 주세요.',
  docSection: '계약 문서',
  fieldsSection: '서명 필드',
  recipientsSection: '받는 분',
  send: '발송',
  sending: '발송 중',
  retry: '다시 시도',
  successTitle: '계약 발송이 완료되었습니다!',
  successBody: '받는 분에게 서명 요청을 보냈어요. 진행 상황은 대시보드에서 확인할 수 있어요.',
  successCta: '대시보드로 가기',
} as const;

type SendState = 'idle' | 'sending' | 'error';

export function ReviewStep() {
  const router = useRouter();
  const { state } = useWizard();
  const { document, fields, recipients } = state;

  const [status, setStatus] = React.useState<SendState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<DocumentSummary | null>(null);

  const canSend =
    document !== null && fields.length > 0 && recipients.length > 0 && status !== 'sending';

  const handleSend = React.useCallback(async () => {
    if (!document) return;
    setStatus('sending');
    setError(null);
    try {
      const token = getToken() ?? undefined;
      // Fields must be persisted before send: the server maps saved fields to
      // recipients by index. Order matters — save, then dispatch.
      await saveFields(document.id, fields, token);
      const summary = await sendContract(document.id, recipients, token);
      // Hand the fresh contract to the dashboard so it shows as '진행 중' at once.
      writeSentSignal(summary);
      setSent(summary);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
      );
      setStatus('error');
    }
  }, [document, fields, recipients, router]);

  const goToDashboard = React.useCallback(() => router.push('/dashboard'), [router]);

  if (sent) {
    return <SendSuccess onContinue={goToDashboard} />;
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">{COPY.title}</h2>
        <p className="text-sm text-foreground-subtle">{COPY.subhead}</p>
      </header>

      <DocumentSummaryCard document={document} fieldCount={fields.length} />
      <FieldsSummaryCard fields={fields} />
      <RecipientsSummaryCard recipients={recipients} />

      {status === 'error' && error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      <Button
        size="lg"
        onClick={() => void handleSend()}
        disabled={!canSend}
        isLoading={status === 'sending'}
        className="w-full"
      >
        {status === 'sending' ? COPY.sending : status === 'error' ? COPY.retry : COPY.send}
      </Button>
    </div>
  );
}

// --- review summary cards ---------------------------------------------------

function SummaryCard({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-lg">
      <div className="flex items-center justify-between gap-sm">
        <h3 className="text-sm font-bold text-foreground-muted">{title}</h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function DocumentSummaryCard({
  document,
  fieldCount,
}: {
  document: DocumentSummary | null;
  fieldCount: number;
}) {
  return (
    <SummaryCard title={COPY.docSection}>
      <div className="flex items-center gap-md">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <DocumentIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <p className="truncate text-base font-bold text-foreground">
            {document?.title ?? '제목 없는 계약'}
          </p>
          <p className="text-sm text-foreground-subtle">{docMeta(document, fieldCount)}</p>
        </div>
      </div>
    </SummaryCard>
  );
}

function docMeta(document: DocumentSummary | null, fieldCount: number): string {
  const parts: string[] = [];
  if (document && document.pageCount > 0) parts.push(`${document.pageCount}페이지`);
  parts.push(`서명 필드 ${fieldCount}개`);
  return parts.join(' · ');
}

function FieldsSummaryCard({ fields }: { fields: SignFieldDraft[] }) {
  // Count per type, in the canonical type order, dropping zero-count types.
  const counts = React.useMemo(() => {
    const acc: Record<SignFieldType, number> = { SIGNATURE: 0, DATE: 0, TEXT: 0 };
    for (const f of fields) acc[f.type] += 1;
    return acc;
  }, [fields]);

  return (
    <SummaryCard
      title={COPY.fieldsSection}
      trailing={<span className="text-sm font-semibold text-foreground-subtle">전체 {fields.length}개</span>}
    >
      <ul className="flex flex-wrap gap-xs">
        {FIELD_TYPES.filter((t) => counts[t] > 0).map((t) => (
          <li
            key={t}
            className="flex items-center gap-2xs rounded-full bg-primary-subtle px-sm py-2xs text-sm font-medium text-primary"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <FieldGlyph type={t} />
            </span>
            {FIELD_TYPE_META[t].label} {counts[t]}개
          </li>
        ))}
      </ul>
    </SummaryCard>
  );
}

function RecipientsSummaryCard({ recipients }: { recipients: RecipientDraft[] }) {
  return (
    <SummaryCard
      title={COPY.recipientsSection}
      trailing={<span className="text-sm font-semibold text-foreground-subtle">{recipients.length}명</span>}
    >
      <ol className="flex flex-col gap-xs">
        {recipients.map((r, i) => (
          <li key={r.id} className="flex items-center gap-sm">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-sm font-bold text-primary"
              aria-label={`서명 순서 ${i + 1}번째`}
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {recipientLabel(r, i)}
              </span>
              <span className="truncate text-sm text-foreground-subtle">{r.email.trim()}</span>
            </div>
          </li>
        ))}
      </ol>
    </SummaryCard>
  );
}

// --- success takeover -------------------------------------------------------

/**
 * Full-viewport celebration. Covers the wizard chrome (header/footer) so the
 * SuccessCheck + Confetti own the moment. The check ring/tick stroke-draw, the
 * confetti bursts once from the mark's center, and the text fades in staggered
 * just behind them. Under reduced-motion the global fallback collapses every
 * animation to its static end-state (check fully drawn, confetti invisible).
 *
 * Rendered through a portal to <body>: the wizard's step container keeps a
 * `transform` (the wizard-step slide, `both` fill), which would otherwise become
 * the containing block for a `position: fixed` child and trap the overlay inside
 * the 760px column. The portal escapes that ancestor so the takeover is truly
 * full-viewport.
 */
function SendSuccess({ onContinue }: { onContinue: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={COPY.successTitle}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-xl bg-background px-md text-center"
    >
      <div className="relative flex items-center justify-center">
        <Confetti className="z-0" />
        <SuccessCheck size={112} className="relative z-10" aria-label={COPY.successTitle} />
      </div>

      <div className="flex max-w-[420px] flex-col items-center gap-sm">
        <h1
          className="animate-fade-in-up text-2xl font-bold text-foreground"
          style={{ animationDelay: '350ms' }}
        >
          {COPY.successTitle}
        </h1>
        <p
          className="animate-fade-in-up text-base text-foreground-subtle"
          style={{ animationDelay: '470ms' }}
        >
          {COPY.successBody}
        </p>
        <Button
          size="lg"
          onClick={onContinue}
          className="animate-fade-in-up mt-sm w-full sm:w-auto"
          style={{ animationDelay: '600ms' }}
        >
          {COPY.successCta}
        </Button>
      </div>
    </div>,
    window.document.body,
  );
}

// --- icons ------------------------------------------------------------------

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M8.5 13h7M8.5 16.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FieldGlyph({ type }: { type: SignFieldType }) {
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
