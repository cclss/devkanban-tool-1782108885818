import type { ReactNode } from 'react';
import { Button, Skeleton, cn } from '@repo/ui';
import { AiBadge, SparkleGlyph } from './ai-badge';

/**
 * SuggestionBanner — the AI auto-placement summary surface.
 *
 * One presentational primitive covering the four states of an AI suggestion
 * run: `analyzing` (skeleton/pulse), `ready` (N suggestions + apply/clear CTAs),
 * `empty` (nothing found), and `error` (run failed). It owns no state and runs
 * no logic — the caller passes the current `state` and the CTA handlers.
 *
 * Active states (`analyzing`/`ready`) wear the AI accent treatment; the resolved
 * states (`empty`/`error`) drop to a neutral surface so the violet glow always
 * means "AI has something for you". `role`/`aria-live` announce state changes;
 * `error` escalates to `alert`. Shared by desktop wizard + mobile signer.
 */
export type SuggestionBannerState =
  | { status: 'analyzing' }
  | { status: 'ready'; count: number }
  | { status: 'empty'; message?: string }
  | { status: 'error'; message?: string };

export interface SuggestionBannerProps {
  state: SuggestionBannerState;
  /** "모두 적용" — apply every suggestion. Rendered only in the `ready` state. */
  onApplyAll?: () => void;
  /** "지우기" — discard the suggestions. Rendered only in the `ready` state. */
  onClear?: () => void;
  /** "다시 분석" — re-run analysis. Rendered only in the `error` state. */
  onRetry?: () => void;
  className?: string;
}

const EMPTY_FALLBACK = '제안할 서명란을 찾지 못했어요. 직접 서명란을 배치해 주세요.';
const ERROR_FALLBACK = '서명란을 분석하지 못했어요. 잠시 후 다시 시도해 주세요.';

export function SuggestionBanner({
  state,
  onApplyAll,
  onClear,
  onRetry,
  className,
}: SuggestionBannerProps) {
  const accented = state.status === 'analyzing' || state.status === 'ready';
  return (
    <section
      role={state.status === 'error' ? 'alert' : 'status'}
      aria-live={state.status === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex flex-col gap-sm rounded-lg border p-md animate-ai-suggest-in',
        accented ? 'border-accent-ai bg-accent-ai-subtle' : 'border-border bg-surface',
        className,
      )}
    >
      {state.status === 'analyzing' ? <AnalyzingBody /> : null}
      {state.status === 'ready' ? (
        <ReadyBody count={state.count} onApplyAll={onApplyAll} onClear={onClear} />
      ) : null}
      {state.status === 'empty' ? (
        <ResolvedBody
          tone="neutral"
          headline="제안할 서명란이 없어요"
          message={state.message ?? EMPTY_FALLBACK}
        />
      ) : null}
      {state.status === 'error' ? (
        <ResolvedBody
          tone="danger"
          headline="분석하지 못했어요"
          message={state.message ?? ERROR_FALLBACK}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                다시 분석
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </section>
  );
}

function AnalyzingBody() {
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-center gap-xs">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-ai-subtle text-accent-ai animate-pulse"
          aria-hidden="true"
        >
          <SparkleGlyph className="h-4 w-4" />
        </span>
        <p className="text-base font-bold text-foreground">서명란을 찾고 있어요</p>
      </div>
      {/* Skeleton bars stand in for the suggestions being assembled. */}
      <div className="flex flex-col gap-2xs">
        <Skeleton shape="text" className="w-3/5" />
        <Skeleton shape="text" className="w-2/5" />
      </div>
    </div>
  );
}

function ReadyBody({
  count,
  onApplyAll,
  onClear,
}: {
  count: number;
  onApplyAll?: () => void;
  onClear?: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-sm">
        <div className="flex flex-col gap-2xs">
          <AiBadge size="sm" />
          <p className="text-base font-bold text-foreground">
            서명란 {count}개를 제안했어요
          </p>
          <p className="text-sm text-foreground-muted">
            검토한 뒤 모두 적용하거나 지울 수 있어요.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-xs">
        <Button variant="ai" size="sm" onClick={onApplyAll}>
          모두 적용
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          지우기
        </Button>
      </div>
    </>
  );
}

function ResolvedBody({
  tone,
  headline,
  message,
  action,
}: {
  tone: 'neutral' | 'danger';
  headline: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-xs">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-danger-subtle text-danger' : 'bg-surface-muted text-foreground-subtle',
        )}
        aria-hidden="true"
      >
        {tone === 'danger' ? <AlertGlyph /> : <InfoGlyph />}
      </span>
      <div className="flex flex-1 flex-col gap-2xs">
        <p className="text-base font-bold text-foreground">{headline}</p>
        <p className="text-sm text-foreground-muted">{message}</p>
        {action ? <div className="pt-2xs">{action}</div> : null}
      </div>
    </div>
  );
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.2v3.2M8 5.4h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M8 2.5 14 13H2L8 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 6.4v2.6M8 11h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
