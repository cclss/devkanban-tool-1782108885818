'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Skeleton } from '@repo/ui';
import { DashboardHeader } from '@/components/dashboard-header';
import { TemplateCard, type TemplateCardActions } from '@/components/template-card';
import { RenameTemplateDialog } from '@/components/rename-template-dialog';
import { DeleteTemplateDialog } from '@/components/delete-template-dialog';
import { TemplatePreviewDialog } from '@/components/template-preview-dialog';
import { ApiError } from '@/lib/api';
import { clearSession, getToken, getUser, type SessionUser } from '@/lib/auth';
import {
  deleteTemplate,
  listTemplates,
  renameTemplate,
  type TemplateSummary,
} from '@/lib/templates';
import { TEMPLATE_ACTIONS_COPY, TEMPLATES_COPY } from '@/lib/templates-copy';

/**
 * `/templates` — the sender's saved-template list ("내 템플릿"), the destination
 * the save-template dialog promises ('다음에 내 템플릿에서 바로 불러올 수 있어요').
 *
 * Lists the owner's templates (name · 페이지 수 · 필드 수 · 저장일) newest-first via
 * `listTemplates()`, with loading / empty / error states. Each card carries the
 * management cluster (manageable Extension): 미리보기 (PDF preview modal) · 이름
 * 수정 (rename modal) · 삭제 (delete-confirm modal) · '이 템플릿으로 시작' (→
 * `/contracts/new?template=id`). Rename and delete are applied **optimistically**:
 * the list updates instantly and, if the server rejects, rolls back and surfaces a
 * dismissible banner. A 401/403 clears the session and bounces to login, mirroring
 * the initial load. The dashboard data flow is untouched; this is a separate route
 * with its own fetch.
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
  /** Banner shown when an optimistic rename/delete is rolled back. */
  const [actionError, setActionError] = React.useState<string | null>(null);

  // The template targeted by each management modal (null = closed).
  const [renameFor, setRenameFor] = React.useState<TemplateSummary | null>(null);
  const [deleteFor, setDeleteFor] = React.useState<TemplateSummary | null>(null);
  const [previewFor, setPreviewFor] = React.useState<TemplateSummary | null>(null);

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

  // A 401/403 mid-mutation means the session lapsed: clear + bounce like `load`.
  // Returns true when it handled the error so callers can stop.
  const bounceIfUnauthorized = React.useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  const handleRename = React.useCallback(
    (template: TemplateSummary, name: string) => {
      setActionError(null);
      // Optimistic: show the new name immediately.
      setTemplates((list) =>
        list ? list.map((t) => (t.id === template.id ? { ...t, name } : t)) : list,
      );
      renameTemplate(template.id, name)
        .then((updated) => {
          // Reconcile with the server's canonical name/updatedAt.
          setTemplates((list) =>
            list
              ? list.map((t) =>
                  t.id === template.id
                    ? { ...t, name: updated.name, updatedAt: updated.updatedAt }
                    : t,
                )
              : list,
          );
        })
        .catch((err: unknown) => {
          if (bounceIfUnauthorized(err)) return;
          // Roll back to the prior name and explain.
          setTemplates((list) =>
            list
              ? list.map((t) => (t.id === template.id ? { ...t, name: template.name } : t))
              : list,
          );
          setActionError(
            err instanceof ApiError ? err.message : TEMPLATE_ACTIONS_COPY.renameFailed,
          );
        });
    },
    [bounceIfUnauthorized],
  );

  const handleDelete = React.useCallback(
    (template: TemplateSummary) => {
      setActionError(null);
      // Remember where it sat so a failed delete can reinsert it in place.
      const index = templates?.findIndex((t) => t.id === template.id) ?? -1;
      setTemplates((list) => (list ? list.filter((t) => t.id !== template.id) : list));
      deleteTemplate(template.id).catch((err: unknown) => {
        if (bounceIfUnauthorized(err)) return;
        setTemplates((list) => {
          if (!list) return list;
          const next = [...list];
          next.splice(index < 0 ? next.length : index, 0, template);
          return next;
        });
        setActionError(
          err instanceof ApiError ? err.message : TEMPLATE_ACTIONS_COPY.deleteFailed,
        );
      });
    },
    [templates, bounceIfUnauthorized],
  );

  const actions = React.useMemo<TemplateCardActions>(
    () => ({
      onStart: (t) => router.push(`${NEW_CONTRACT_ROUTE}?template=${encodeURIComponent(t.id)}`),
      onPreview: setPreviewFor,
      onRename: setRenameFor,
      onDelete: setDeleteFor,
    }),
    [router],
  );

  if (!ready) return null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <DashboardHeader user={user} onLogout={() => { clearSession(); router.replace('/login'); }} />

      <main className="mx-auto w-full max-w-[960px] px-md py-xl sm:py-2xl">
        <div className="flex flex-col gap-2xs">
          <h1 className="text-2xl font-bold text-foreground">{TEMPLATES_COPY.title}</h1>
          <p className="text-base text-foreground-subtle">{TEMPLATES_COPY.description}</p>
        </div>

        {actionError ? (
          <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        ) : null}

        <section className="mt-xl" aria-label={TEMPLATES_COPY.listLabel}>
          <TemplatesBody
            templates={templates}
            error={error}
            actions={actions}
            onRetry={() => void load()}
            onCreate={() => router.push(NEW_CONTRACT_ROUTE)}
          />
        </section>
      </main>

      <RenameTemplateDialog
        open={renameFor !== null}
        onOpenChange={(open) => { if (!open) setRenameFor(null); }}
        template={renameFor}
        onSubmit={handleRename}
      />
      <DeleteTemplateDialog
        open={deleteFor !== null}
        onOpenChange={(open) => { if (!open) setDeleteFor(null); }}
        template={deleteFor}
        onConfirm={handleDelete}
      />
      <TemplatePreviewDialog
        open={previewFor !== null}
        onOpenChange={(open) => { if (!open) setPreviewFor(null); }}
        template={previewFor}
      />
    </div>
  );
}

/** Dismissible banner for an optimistic rename/delete that was rolled back. */
function ActionErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="mt-md flex items-center gap-sm rounded-md border border-danger/30 bg-danger-subtle px-md py-sm"
    >
      <p className="flex-1 text-sm font-medium text-danger">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={TEMPLATE_ACTIONS_COPY.preview_dialog.close}
        className="shrink-0 rounded-md p-2xs text-danger transition-colors duration-fast ease-standard hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function TemplatesBody({
  templates,
  error,
  actions,
  onRetry,
  onCreate,
}: {
  templates: TemplateSummary[] | null;
  error: string | null;
  actions: TemplateCardActions;
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
          <TemplateCard template={template} actions={actions} />
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
