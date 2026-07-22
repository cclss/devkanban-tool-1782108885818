'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@repo/ui';
import { ContractCard } from '@/components/contract-card';
import { DashboardHeader } from '@/components/dashboard-header';
import {
  DashboardSummary,
  SUMMARY_FILTERS,
  type SummaryFilterKey,
} from '@/components/dashboard-summary';
import { KanbanBoard } from '@/components/kanban-board';
import { OnboardingGuide } from '@/components/onboarding-guide';
import { ViewSwitcher } from '@/components/view-switcher';
import { ApiError } from '@/lib/api';
import { isOnboardingComplete, markOnboardingComplete } from '@/lib/onboarding';
import { readViewMode, writeViewMode, type ViewMode } from '@/lib/view-mode';
import { ONBOARDING_COPY } from '@/lib/onboarding-copy';
import { clearSession, getUser, getToken, type SessionUser } from '@/lib/auth';
import {
  fetchDocuments,
  fetchQuota,
  takeSentSignal,
  type DocumentSummary,
  type Quota,
  type Urgency,
} from '@/lib/documents';
import {
  FILTERED_EMPTY_COPY,
  KANBAN_BOARD_COPY,
  SUMMARY_COPY,
  VIEW_SWITCHER_COPY,
} from '@/lib/todo-copy';
import { TEMPLATES_ENTRY_LABEL } from '@/lib/templates-copy';

/**
 * Dashboard list ordering by urgency (design-spec/components/urgency-badge/base.md
 * — "목록 기본 정렬(OVERDUE 우선)"): OVERDUE first, then DUE_SOON, then NORMAL.
 * Array.prototype.sort is stable, so within one urgency the API's newest-first
 * order is preserved.
 */
const URGENCY_ORDER: Record<Urgency, number> = { OVERDUE: 0, DUE_SOON: 1, NORMAL: 2 };

function sortByUrgency(docs: DocumentSummary[]): DocumentSummary[] {
  return [...docs].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
}

const NEW_CONTRACT_ROUTE = '/contracts/new';
const TEMPLATES_ROUTE = '/templates';

export default function DashboardPage() {
  const router = useRouter();

  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [documents, setDocuments] = React.useState<DocumentSummary[] | null>(null);
  const [quota, setQuota] = React.useState<Quota | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Id of a just-sent contract to highlight after an optimistic prepend.
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  // Active summary-card filter, or null when the list is unfiltered.
  const [filter, setFilter] = React.useState<SummaryFilterKey | null>(null);
  // 목록/칸반 view choice. Switching is a pure conditional render — it never
  // resets `filter`, refetches, or drops the loaded `documents` (context is
  // preserved). Persisted to localStorage so it survives a reload; the persisted
  // value only *seeds* this once after mount (below) and never clobbers an
  // in-session choice.
  const [viewMode, setViewMode] = React.useState<ViewMode>('list');
  // First-run onboarding: whether the welcome guide has been permanently retired.
  // Read once from persistence after mount (client-only, so no SSR/hydration read);
  // flips to true the moment the first real contract appears and never back.
  const [onboardingComplete, setOnboardingComplete] = React.useState(false);

  // Bounce unauthenticated visitors to login before any data work.
  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    // Optimistic hand-off from the send wizard: show the new contract at once.
    const sent = takeSentSignal();
    if (sent) {
      setDocuments([sent]);
      setHighlightId(sent.id);
    }
    setReady(true);
  }, [router]);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [docs, q] = await Promise.all([fetchDocuments(), fetchQuota()]);
      // Merge over any optimistic entry: server data wins, de-duped by id,
      // newest-first order preserved by the API.
      setDocuments(docs);
      setQuota(q);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
  }, [router]);

  // Initial load + revalidate whenever the tab regains focus (e.g. returning
  // from the send wizard), so a freshly sent contract appears as '진행 중'.
  React.useEffect(() => {
    if (!ready) return;
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ready, load]);

  // Load the persisted onboarding flag once we're client-ready. Kept in state so
  // the guide reacts to being retired within this session.
  React.useEffect(() => {
    if (!ready) return;
    setOnboardingComplete(isOnboardingComplete());
  }, [ready]);

  // Seed the view choice from persistence once, after mount (client-only, so no
  // SSR/hydration read). This only initializes the session's view; every later
  // switch flows through `changeViewMode` and is never reset by this effect.
  React.useEffect(() => {
    if (!ready) return;
    setViewMode(readViewMode());
  }, [ready]);

  // Switch views: update session state and persist the choice. A pure state flip —
  // it deliberately leaves `filter`, `documents`, and load state untouched, so the
  // 목록↔칸반 switch loses no context and triggers no refetch.
  const changeViewMode = React.useCallback((mode: ViewMode) => {
    setViewMode(mode);
    writeViewMode(mode);
  }, []);

  // Permanently retire the first-run guide the moment the first real contract
  // lands in the list — including a DRAFT created by upload (documents.length > 0).
  // Once marked complete the guide never returns, even if the list later empties.
  React.useEffect(() => {
    if (onboardingComplete) return;
    if (documents && documents.length > 0) {
      markOnboardingComplete();
      setOnboardingComplete(true);
    }
  }, [documents, onboardingComplete]);

  // Clear the highlight shortly after it's shown.
  React.useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlightId(null), 2400);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  // The rendered list: filtered by the active summary card (same predicate the
  // cards count with, so "card count === filtered list count"), then ordered by
  // urgency (OVERDUE first). Counts on the summary cards use the *full* list.
  const visible = React.useMemo(() => {
    if (!documents) return null;
    const filtered = filter ? documents.filter(SUMMARY_FILTERS[filter]) : documents;
    return sortByUrgency(filtered);
  }, [documents, filter]);

  // Show the first-run welcome guide only to a genuinely new user: real contract
  // list is loaded and empty, and onboarding hasn't been completed before. When
  // shown, the guide takes the place of the plain EmptyState (it shows the path to
  // a first contract, whereas EmptyState is the calm "nothing here" endpoint —
  // components/onboarding-guide/base.md keeps the two roles distinct).
  const showOnboarding = documents !== null && documents.length === 0 && !onboardingComplete;

  if (!ready) return null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <DashboardHeader user={user} onLogout={() => { clearSession(); router.replace('/login'); }} />

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <div className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2xs">
            <h1 className="text-2xl font-bold text-foreground">계약</h1>
            <p className="text-base text-foreground-subtle">
              보낸 계약의 진행 상황을 한눈에 확인하세요.
            </p>
          </div>
          <div className="flex items-center gap-xs">
            <Button variant="secondary" size="lg" asChild className="sm:w-auto">
              <Link href={TEMPLATES_ROUTE}>{TEMPLATES_ENTRY_LABEL}</Link>
            </Button>
            <Button size="lg" onClick={() => router.push(NEW_CONTRACT_ROUTE)} className="sm:w-auto">
              새 계약 생성
            </Button>
          </div>
        </div>

        <PlanUsage quota={quota} plan={user?.plan} className="mt-lg" />

        <section className="mt-xl" aria-label="계약 목록">
          {/* The switcher + summary sit at the top of the list section. Both only
              appear once contracts exist — with an empty/onboarding dashboard there
              is nothing to switch between. The summary stays mounted in both views
              so its filter (context) persists across a 목록↔칸반 switch. */}
          {documents && documents.length > 0 ? (
            <div className="mb-lg flex flex-col gap-md">
              <div className="flex justify-end">
                <ViewSwitcher
                  value={viewMode}
                  onChange={changeViewMode}
                  copy={VIEW_SWITCHER_COPY}
                />
              </div>
              <DashboardSummary
                documents={documents}
                copy={SUMMARY_COPY}
                selected={filter}
                onSelect={setFilter}
              />
            </div>
          ) : null}
          {/* Pure conditional render: kanban swaps only the body. `filter`, loaded
              `documents`, and load state are all held by the parent and untouched,
              so switching loses no context. The board lays out the *same* `visible`
              set the list shows (filtered by the active summary card + urgency-
              sorted), so the filter applies identically in both views. Loading /
              empty / onboarding / error all flow through DashboardBody (the list
              path) — there is nothing to lay out on a board until contracts load. */}
          {documents && documents.length > 0 && viewMode === 'kanban' && visible ? (
            <KanbanBoard
              documents={visible}
              copy={KANBAN_BOARD_COPY}
              highlightId={highlightId}
            />
          ) : (
            <DashboardBody
              documents={documents}
              visible={visible}
              filtered={filter !== null}
              onClearFilter={() => setFilter(null)}
              error={error}
              highlightId={highlightId}
              showOnboarding={showOnboarding}
              onRetry={() => void load()}
              onCreate={() => router.push(NEW_CONTRACT_ROUTE)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function PlanUsage({
  quota,
  plan,
  className,
}: {
  quota: Quota | null;
  plan?: string;
  className?: string;
}) {
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);
  const isFree = !plan || plan === 'FREE';

  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-md p-lg">
        <div className="flex min-w-0 flex-col gap-2xs">
          <div className="flex items-center gap-xs">
            <span className="text-sm font-bold text-foreground">
              {isFree ? 'Free 플랜' : `${plan} 플랜`}
            </span>
            {isFree ? (
              <span className="rounded-full bg-grey-100 px-xs py-2xs text-2xs font-semibold text-foreground-subtle">
                무료
              </span>
            ) : null}
          </div>
          {quota ? (
            <p className="text-sm text-foreground-subtle">
              이번 달 발송{' '}
              <span className="font-semibold text-foreground">{quota.used}</span>
              <span className="text-foreground-subtle">/{quota.limit}건</span>
            </p>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
        </div>
        {isFree ? (
          <Button variant="secondary" size="sm" onClick={() => setUpgradeOpen(true)}>
            업그레이드
          </Button>
        ) : null}
      </div>

      {isFree ? <QuotaBar quota={quota} /> : null}

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>곧 유료 플랜을 만나요</DialogTitle>
            <DialogDescription>
              더 넉넉한 발송 한도와 팀 기능을 준비하고 있어요. 조금만 기다려 주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">알겠어요</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function QuotaBar({ quota }: { quota: Quota | null }) {
  const pct = quota && quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const exhausted = Boolean(quota && quota.remaining <= 0);

  return (
    <div className="px-lg pb-lg">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-grey-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quota?.limit ?? 5}
        aria-valuenow={quota?.used ?? 0}
        aria-label="이번 달 발송 사용량"
      >
        <div
          className={
            'h-full rounded-full transition-[width] duration-base ease-out-expressive ' +
            (exhausted ? 'bg-warning' : 'bg-primary')
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      {exhausted ? (
        <p className="mt-xs text-sm font-medium text-warning">
          이번 달 무료 발송 5건을 모두 사용했어요. 다음 달에 다시 발송할 수 있어요.
        </p>
      ) : null}
    </div>
  );
}

function DashboardBody({
  documents,
  visible,
  filtered,
  onClearFilter,
  error,
  highlightId,
  showOnboarding,
  onRetry,
  onCreate,
}: {
  /** The full list — drives the null/empty (no-contracts) states. */
  documents: DocumentSummary[] | null;
  /** The filtered + urgency-sorted list actually rendered. */
  visible: DocumentSummary[] | null;
  /** Whether a summary-card filter is active. */
  filtered: boolean;
  onClearFilter: () => void;
  error: string | null;
  highlightId: string | null;
  /** Show the first-run welcome guide in place of the plain EmptyState. */
  showOnboarding: boolean;
  onRetry: () => void;
  onCreate: () => void;
}) {
  // Error only blocks when we have nothing to show; otherwise keep the list.
  if (error && (!documents || documents.length === 0)) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (documents === null || visible === null) {
    return <SkeletonList />;
  }
  if (documents.length === 0) {
    // A new user (never onboarded) gets the welcome guide — the path to a first
    // contract. Everyone else gets the calm EmptyState endpoint. Both reuse the
    // same onCreate → NEW_CONTRACT_ROUTE flow.
    return showOnboarding ? (
      <OnboardingGuide
        title={ONBOARDING_COPY.title}
        description={ONBOARDING_COPY.description}
        steps={ONBOARDING_COPY.steps}
        ctaLabel={ONBOARDING_COPY.cta}
        onCreate={onCreate}
      />
    ) : (
      <EmptyState onCreate={onCreate} />
    );
  }
  // Contracts exist, but none match the active filter — say so calmly and offer
  // the next action (clear the filter), rather than the wrong "no contracts yet".
  if (visible.length === 0 && filtered) {
    return <FilteredEmptyState onClearFilter={onClearFilter} />;
  }
  return (
    <ul className="motion-stagger flex flex-col gap-sm">
      {visible.map((doc, i) => (
        <li
          key={doc.id}
          style={{ ['--stagger-index' as string]: Math.min(i, 12) } as React.CSSProperties}
        >
          <ContractCard document={doc} highlighted={doc.id === highlightId} />
        </li>
      ))}
    </ul>
  );
}

function SkeletonList() {
  return (
    <ul className="flex flex-col gap-sm" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <Card className="flex items-center gap-md p-lg">
            <Skeleton shape="rect" className="h-11 w-11" />
            <div className="flex flex-1 flex-col gap-xs">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="motion-stagger flex flex-col items-center gap-md px-lg py-3xl text-center">
      <EmptyIllustration />
      <div className="flex flex-col gap-2xs">
        <h2 className="text-lg font-bold text-foreground">아직 보낸 계약이 없어요</h2>
        <p className="text-base text-foreground-subtle">
          첫 계약을 만들고 받는 분에게 서명을 요청해 보세요.
        </p>
      </div>
      <Button size="lg" onClick={onCreate}>
        새 계약 생성
      </Button>
    </Card>
  );
}

function FilteredEmptyState({ onClearFilter }: { onClearFilter: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-base text-foreground-subtle">{FILTERED_EMPTY_COPY.message}</p>
      <Button variant="secondary" onClick={onClearFilter}>
        {FILTERED_EMPTY_COPY.clear}
      </Button>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-base text-foreground-muted">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </Card>
  );
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" fill="none" aria-hidden="true">
      <rect x="22" y="14" width="44" height="58" rx="8" className="fill-primary-subtle" />
      <rect
        x="22"
        y="14"
        width="44"
        height="58"
        rx="8"
        stroke="currentColor"
        strokeWidth="2.2"
        className="text-border-strong"
      />
      <path
        d="M33 34h22M33 44h22M33 54h14"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="text-grey-300"
      />
      <circle cx="68" cy="68" r="14" className="fill-primary" />
      <path d="M68 62v12M62 68h12" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
