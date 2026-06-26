'use client';

/**
 * Wizard step 4 — confirm & send ("발송 검토").
 *
 * grain-4 splits the last step into two *separate, ordered* affordances so the
 * confirmation deliverable ("확정한 서명란이 적용된 미리보기 + 발송 준비") stands
 * on its own, and so a mobile field worker can "확정만 저장하고 나중에 발송":
 *
 *   1. Review → "이대로 확정" — persists the placed fields with their provenance
 *      (`saveFields`, grain-2). Saving ≥1 field flips the document DRAFT → READY
 *      ("발송 준비 완료") server-side; send is *not* triggered here.
 *   2. Ready → "발송" — a distinct CTA that dispatches the (already-saved)
 *      contract (`sendContract`). The 발송 준비 완료 status badge + a provenance
 *      read-back (AI 제안 그대로 N개 / 직접 배치·조정 M개, 종류·페이지별 개수)
 *      confirm what's about to go out.
 *   3. Success — the celebratory takeover once the dispatch lands:
 *      "계약 발송이 완료되었습니다!" (SuccessCheck stroke-draw + Confetti, both
 *      reduced-motion-safe) with a staggered text fade-in.
 *
 * Going back to adjust fields remounts this step (the shell re-keys by step), so
 * the local confirm state resets and the sender simply re-confirms — the server
 * stays READY meanwhile, and re-saving just replaces the field set. On failure
 * we surface the server's Korean message and let the user retry; a 401 means the
 * session lapsed, so we bounce to /login. On send success we stash the summary
 * via `writeSentSignal` so the dashboard shows it as '진행 중' at once.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Button, Confetti, SuccessCheck } from '@repo/ui';
import { ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { writeSentSignal, type DocumentStatus, type DocumentSummary } from '@/lib/documents';
import { SparkleGlyph } from '../ai/ai-badge';
import { FIELD_TYPE_META, type SignFieldType } from '@/lib/field-geometry';
import { summarizeFields, type FieldSummary } from '@/lib/field-summary';
import { recipientLabel } from '@/lib/recipients';
import { saveFields, sendContract, type SaveFieldsResult } from '@/lib/send';
import { StatusBadge } from '../status-badge';
import { useWizard, type RecipientDraft } from './wizard-context';

const COPY = {
  // Review (pre-confirm): the read-back + the confirm affordance.
  reviewTitle: '발송 전 확인해 주세요',
  reviewSubhead: 'AI가 배치한 서명란이 맞는지 확인하고 확정해 주세요.',
  confirm: '이대로 확정',
  confirming: '확정하는 중',
  // Ready (post-confirm): 발송 준비 완료 + the separate send affordance.
  readyTitle: '발송 준비가 끝났어요',
  readySubhead: '받는 분에게 보낼 내용을 검토하고, 준비되면 발송해 주세요.',
  laterHint: '지금 발송하지 않아도 돼요. 확정한 내용은 저장됐으니 대시보드에서 이어서 발송할 수 있어요.',
  // Shared summary section labels.
  docSection: '계약 문서',
  fieldsSection: '서명 필드',
  sourceSection: '서명란 출처',
  sourceAi: 'AI 제안 그대로',
  sourceAdjusted: '직접 배치·조정',
  pagesLabel: '페이지별',
  recipientsSection: '받는 분',
  send: '발송',
  sending: '발송 중',
  retry: '다시 시도',
  successTitle: '계약 발송이 완료되었습니다!',
  successBody: '받는 분에게 서명 요청을 보냈어요. 진행 상황은 대시보드에서 확인할 수 있어요.',
  successCta: '대시보드로 가기',
} as const;

const GENERIC_ERROR = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';

type ConfirmState = 'review' | 'confirming' | 'ready';
type SendState = 'idle' | 'sending';

export function ReviewStep() {
  const router = useRouter();
  const { state } = useWizard();
  const { document, fields, recipients } = state;

  const [phase, setPhase] = React.useState<ConfirmState>('review');
  const [sendState, setSendState] = React.useState<SendState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  /** The server's send-readiness result, set once "이대로 확정" lands. */
  const [ready, setReady] = React.useState<SaveFieldsResult | null>(null);
  const [sent, setSent] = React.useState<DocumentSummary | null>(null);

  const summary = React.useMemo(() => summarizeFields(fields), [fields]);

  const canConfirm =
    document !== null && fields.length > 0 && recipients.length > 0 && phase !== 'confirming';
  const canSend = ready !== null && recipients.length > 0 && sendState !== 'sending';

  const failWith = React.useCallback(
    (err: unknown): boolean => {
      // Returns true when handled by redirect (caller should bail silently).
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return true;
      }
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
      return false;
    },
    [router],
  );

  // Step 1 — persist the confirmed fields (DRAFT → READY). Send stays separate.
  const handleConfirm = React.useCallback(async () => {
    if (!document) return;
    setPhase('confirming');
    setError(null);
    try {
      const result = await saveFields(document.id, fields, getToken() ?? undefined);
      setReady(result);
      setPhase('ready');
    } catch (err) {
      if (!failWith(err)) setPhase('review');
    }
  }, [document, fields, failWith]);

  // Step 2 — dispatch the already-saved contract. Distinct, deliberate action.
  const handleSend = React.useCallback(async () => {
    if (!document) return;
    setSendState('sending');
    setError(null);
    try {
      const sentSummary = await sendContract(document.id, recipients, getToken() ?? undefined);
      // Hand the fresh contract to the dashboard so it shows as '진행 중' at once.
      writeSentSignal(sentSummary);
      setSent(sentSummary);
    } catch (err) {
      failWith(err);
      setSendState('idle');
    }
  }, [document, recipients, failWith]);

  const goToDashboard = React.useCallback(() => router.push('/dashboard'), [router]);

  if (sent) {
    return <SendSuccess onContinue={goToDashboard} />;
  }

  const isReady = phase === 'ready';

  return (
    <div className="flex flex-col gap-lg">
      {isReady && ready ? (
        <ReadyHeader result={ready} />
      ) : (
        <header className="flex flex-col gap-2xs">
          <h2 className="text-xl font-bold text-foreground">{COPY.reviewTitle}</h2>
          <p className="text-sm text-foreground-subtle">{COPY.reviewSubhead}</p>
        </header>
      )}

      <DocumentSummaryCard document={document} fieldCount={fields.length} />
      <FieldsSummaryCard summary={summary} showProvenance={isReady} />
      <RecipientsSummaryCard recipients={recipients} />

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-subtle px-md py-sm text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {isReady ? (
        <div className="flex flex-col gap-sm">
          <Button
            size="lg"
            onClick={() => void handleSend()}
            disabled={!canSend}
            isLoading={sendState === 'sending'}
            className="w-full"
          >
            {sendState === 'sending' ? COPY.sending : error ? COPY.retry : COPY.send}
          </Button>
          <p className="text-xs text-foreground-subtle">{COPY.laterHint}</p>
        </div>
      ) : (
        <Button
          size="lg"
          onClick={() => void handleConfirm()}
          disabled={!canConfirm}
          isLoading={phase === 'confirming'}
          className="w-full"
        >
          {phase === 'confirming' ? COPY.confirming : error ? COPY.retry : COPY.confirm}
        </Button>
      )}
    </div>
  );
}

// --- ready (발송 준비 완료) header -------------------------------------------

/**
 * The post-confirm header: the 발송 준비 완료 status badge (design-spec
 * status-badge `ready-to-send`, success tone) over the encouraging "준비가
 * 끝났어요" copy. The badge's status + label come from the server's save result
 * (single source of truth), so it reads identically to the dashboard pill.
 */
function ReadyHeader({ result }: { result: SaveFieldsResult }) {
  return (
    <header className="flex flex-col gap-sm">
      <StatusBadge status={result.status as DocumentStatus} label={result.statusLabel} />
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">{COPY.readyTitle}</h2>
        <p className="text-sm text-foreground-subtle">{COPY.readySubhead}</p>
      </div>
    </header>
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

/**
 * Field read-back: per-type pills + per-page counts, and — once confirmed —
 * the provenance split that tells the "AI 제안 → 사용자 확정" story
 * (`showProvenance`). The provenance row reuses the feature's provenance visual
 * language: AI-kept = accent-ai (violet, the AI accent), 직접 배치·조정 =
 * primary (blue, the confirmed-field hue) — never color alone, the count label
 * carries the meaning.
 */
function FieldsSummaryCard({
  summary,
  showProvenance,
}: {
  summary: FieldSummary;
  showProvenance: boolean;
}) {
  const { ai, adjusted } = summary.provenance;

  return (
    <SummaryCard
      title={COPY.fieldsSection}
      trailing={<span className="text-sm font-semibold text-foreground-subtle">전체 {summary.total}개</span>}
    >
      <ul className="flex flex-wrap gap-xs">
        {summary.byType.map(({ type, count }) => (
          <li
            key={type}
            className="flex items-center gap-2xs rounded-full bg-primary-subtle px-sm py-2xs text-sm font-medium text-primary"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <FieldGlyph type={type} />
            </span>
            {FIELD_TYPE_META[type].label} {count}개
          </li>
        ))}
      </ul>

      {showProvenance && summary.total > 0 ? (
        <div className="flex flex-col gap-2xs border-t border-border pt-sm">
          <span className="text-xs font-semibold text-foreground-muted">{COPY.sourceSection}</span>
          <div className="flex flex-wrap gap-xs">
            {ai > 0 ? (
              <span className="flex items-center gap-2xs rounded-full bg-accent-ai-subtle px-sm py-2xs text-sm font-medium text-accent-ai">
                <SparkleGlyph className="h-3.5 w-3.5" />
                {COPY.sourceAi} {ai}개
              </span>
            ) : null}
            {adjusted > 0 ? (
              <span className="flex items-center gap-2xs rounded-full bg-primary-subtle px-sm py-2xs text-sm font-medium text-primary">
                {COPY.sourceAdjusted} {adjusted}개
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {summary.byPage.length > 0 ? (
        <div className="flex flex-col gap-2xs border-t border-border pt-sm">
          <span className="text-xs font-semibold text-foreground-muted">{COPY.pagesLabel}</span>
          <ul className="flex flex-wrap gap-x-md gap-y-2xs text-sm text-foreground-subtle">
            {summary.byPage.map(({ page, count }) => (
              <li key={page}>
                <span className="font-medium text-foreground-muted">{page}페이지</span> {count}개
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
