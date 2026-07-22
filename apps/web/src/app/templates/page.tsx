'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Skeleton } from '@repo/ui';
import { DashboardHeader } from '@/components/dashboard-header';
import { TemplateCard } from '@/components/template-card';
import { ApiError } from '@/lib/api';
import { clearSession, getToken, getUser, type SessionUser } from '@/lib/auth';
import { listTemplates, type TemplateSummary } from '@/lib/templates';
import { TEMPLATES_COPY } from '@/lib/templates-copy';

/**
 * `/templates` — the sender's saved-template list ("내 템플릿"), the destination
 * the save-template dialog promises ('다음에 내 템플릿에서 바로 불러올 수 있어요').
 *
 * Read-only for this grain: it lists the owner's templates (name · 페이지 수 ·
 * 필드 수 · 저장일) newest-first via `listTemplates()`, with loading / empty /
 * error states. Rename, delete, preview, and loading a template back into the
 * wizard are later grains — no mutate affordance is rendered here. The dashboard
 * data flow is untouched; this is a separate route with its own fetch.
 *
 * Auth + header are shared with the dashboard: unauthenticated visitors bounce to
 * login before any data work, and a 401/403 mid-flight clears the session and
 * redirects, mirroring `dashboard/page.tsx`.
 */
const NEW_CONTRACT_ROUTE = '/contracts/new';

export default function TemplatesPage() {
  const router = useRouter();

  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [templates, setTemplates] = React.useState<TemplateSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setReady(true);
  }, [router]);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setTemplates(await listTemplates());
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        router.replace('/login');
        return;
      }
      setError(
        err instanceof ApiError ? err.message : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
      );
    }
  }, [router]);

  React.useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  if (!ready) return null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <DashboardHeader user={user} onLogout={() => { clearSession(); router.replace('/login'); }} />

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <div className="flex flex-col gap-2xs">
          <h1 className="text-2xl font-bold text-foreground">{TEMPLATES_COPY.title}</h1>
          <p className="text-base text-foreground-subtle">{TEMPLATES_COPY.description}</p>
        </div>

        <section className="mt-xl" aria-label={TEMPLATES_COPY.listLabel}>
          <TemplatesBody
            templates={templates}
            error={error}
            onRetry={() => void load()}
            onCreate={() => router.push(NEW_CONTRACT_ROUTE)}
          />
        </section>
      </main>
    </div>
  );
}

function TemplatesBody({
  templates,
  error,
  onRetry,
  onCreate,
}: {
  templates: TemplateSummary[] | null;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
}) {
  if (error && !templates) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }
  if (templates === null) {
    return <SkeletonList />;
  }
  if (templates.length === 0) {
    return <EmptyState onCreate={onCreate} />;
  }
  return (
    <ul className="motion-stagger flex flex-col gap-sm">
      {templates.map((template, i) => (
        <li
          key={template.id}
          style={{ ['--stagger-index' as string]: Math.min(i, 12) } as React.CSSProperties}
        >
          <TemplateCard template={template} />
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
        <h2 className="text-lg font-bold text-foreground">{TEMPLATES_COPY.emptyTitle}</h2>
        <p className="max-w-[380px] text-base text-foreground-subtle">
          {TEMPLATES_COPY.emptyDescription}
        </p>
      </div>
      <Button size="lg" onClick={onCreate}>
        {TEMPLATES_COPY.emptyCta}
      </Button>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="text-base text-foreground-muted">{message}</p>
      <Button variant="secondary" onClick={onRetry}>
        {TEMPLATES_COPY.errorRetry}
      </Button>
    </Card>
  );
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 96 96" className="h-20 w-20" fill="none" aria-hidden="true">
      <rect x="16" y="26" width="44" height="54" rx="8" className="fill-primary-subtle" />
      <rect
        x="16"
        y="26"
        width="44"
        height="54"
        rx="8"
        stroke="currentColor"
        strokeWidth="2.2"
        className="text-border-strong"
      />
      <path
        d="M26 44h24M26 54h24M26 64h16"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="text-grey-300"
      />
      <rect x="36" y="16" width="44" height="54" rx="8" className="fill-surface" />
      <rect
        x="36"
        y="16"
        width="44"
        height="54"
        rx="8"
        stroke="currentColor"
        strokeWidth="2.2"
        className="text-primary"
      />
      <circle cx="70" cy="60" r="12" className="fill-primary" />
      <path d="M70 55v10M65 60h10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
