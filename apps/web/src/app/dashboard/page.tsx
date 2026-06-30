'use client';

import * as React from 'react';
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
import { StatusBadge } from '@/components/status-badge';
import { CompletionDownload } from '@/components/completion-download';
import { ApiError } from '@/lib/api';
import { clearSession, getUser, getToken, type SessionUser } from '@/lib/auth';
import {
  downloadOwnerArtifact,
  fetchDocuments,
  fetchQuota,
  takeSentSignal,
  type DocumentSummary,
  type Quota,
} from '@/lib/documents';

const NEW_CONTRACT_ROUTE = '/contracts/new';

export default function DashboardPage() {
  const router = useRouter();

  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [documents, setDocuments] = React.useState<DocumentSummary[] | null>(null);
  const [quota, setQuota] = React.useState<Quota | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Id of a just-sent contract to highlight after an optimistic prepend.
  const [highlightId, setHighlightId] = React.useState<string | null>(null);

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

  // Clear the highlight shortly after it's shown.
  React.useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlightId(null), 2400);
    return () => window.clearTimeout(t);
  }, [highlightId]);

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
          <Button size="lg" onClick={() => router.push(NEW_CONTRACT_ROUTE)} className="sm:w-auto">
            새 계약 생성
          </Button>
        </div>

        <PlanUsage quota={quota} plan={user?.plan} className="mt-lg" />

        <section className="mt-xl" aria-label="계약 목록">
          <DashboardBody
            documents={documents}
            error={error}
            highlightId={highlightId}
            onRetry={() => void load()}
            onCreate={() => router.push(NEW_CONTRACT_ROUTE)}
          />
        </section>
      </main>
    </div>
  );
}

function DashboardHeader({ user, onLogout }: { user: SessionUser | null; onLogout: () => void }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-md py-sm">
        <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
        <div className="flex items-center gap-xs">
          {user?.email ? (
            <span className="hidden text-sm text-foreground-subtle sm:inline">{user.email}</span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => router.push('/settings/branding')}>
            회사 설정
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            로그아웃
          </Button>
        </div>
      </div>
    </header>
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
  error,
  highlightId,
  onRetry,
  onCreate,
}: {
  documents: DocumentSummary[] | null;
  error: string | null;
  highlightId: string | null;
  onRetry: () => void;
  onCreate: () => void;
}) {
  // Error only blocks when we have nothing to show; otherwise keep the list.
  if (error && (!documents || documents.length === 0)) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (documents === null) {
    return <SkeletonList />;
  }
  if (documents.length === 0) {
    return <EmptyState onCreate={onCreate} />;
  }
  return (
    <ul className="motion-stagger flex flex-col gap-sm">
      {documents.map((doc, i) => (
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

function ContractCard({ document, highlighted }: { document: DocumentSummary; highlighted: boolean }) {
  const completed = document.status === 'COMPLETED';
  return (
    <Card
      interactive
      className={
        'flex flex-col gap-md p-lg transition-shadow ' +
        (highlighted ? 'ring-2 ring-focus' : '')
      }
    >
      <div className="flex items-center gap-md">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <DocumentIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <div className="flex items-center gap-xs">
            <h3 className="truncate text-base font-bold text-foreground">{document.title}</h3>
            {/* Completed cards carry the 완료됨 badge inside the download area
                below, so the title row omits it to avoid a duplicate badge. */}
            {!completed ? (
              <StatusBadge status={document.status} label={document.statusLabel} />
            ) : null}
          </div>
          <p className="truncate text-sm text-foreground-subtle">{metaLine(document)}</p>
        </div>
        {!completed ? <ChevronIcon /> : null}
      </div>

      {completed ? (
        <CompletionDownload
          className="border-t border-border pt-md"
          ready={document.downloadsReady}
          completedAt={document.completedAt}
          statusLabel={document.statusLabel}
          onDownload={(kind) => downloadOwnerArtifact(document.id, kind, document.title)}
        />
      ) : null}
    </Card>
  );
}

function metaLine(doc: DocumentSummary): string {
  const parts: string[] = [];
  if (doc.recipientCount > 0) parts.push(`받는 분 ${doc.recipientCount}명`);
  if (doc.pageCount > 0) parts.push(`${doc.pageCount}페이지`);
  const sent = doc.status !== 'DRAFT' && doc.sentAt;
  const when = formatRelative(sent ? (doc.sentAt as string) : doc.createdAt);
  parts.push(sent ? `${when} 발송` : `${when} 생성`);
  return parts.join(' · ');
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(then);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M8.5 13h7M8.5 16.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-grey-400" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
