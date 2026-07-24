'use client';

/**
 * NewContractStart — the entry chooser that sits in front of the contract wizard
 * on `/contracts/new` (design-spec `tone/new-contract-start.md`,
 * `components/start-choice-card/base.md`).
 *
 * Two ways to start:
 * - **새로 업로드**: the classic from-scratch path — mount `<ContractWizard />`
 *   with no preload (upload → fields → delivery → …). Unchanged behavior.
 * - **내 템플릿에서 시작**: pick a saved template; we re-register its PDF as a
 *   fresh DRAFT (`createDocumentFromStorageKey`), reload its bytes
 *   (`fetchTemplateFile`), and hydrate its saved field layout, then mount
 *   `<ContractWizard preload={…} />` straight at the recipients step so only
 *   signer info remains before sending.
 *
 * A `?template=<id>` query jumps past the chooser and prepares that template
 * immediately (e.g. a "이 템플릿으로 보내기" deep link). Loading / error copy is
 * 해요체; server-sent errors (not-found / forbidden) surface verbatim, transport
 * failures fall back to the neutral generic line, and a 401 bounces to /login
 * like the send flow.
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, Skeleton } from '@repo/ui';
import { ApiError, GENERIC_ERROR } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { createDocumentFromStorageKey } from '@/lib/documents';
import {
  fetchTemplateFile,
  getTemplate,
  listTemplates,
  type TemplateField,
  type TemplateSummary,
} from '@/lib/templates';
import { NEW_CONTRACT_COPY as COPY } from '@/lib/new-contract-copy';
import { TemplateCard } from '@/components/template-card';
import { ContractWizard } from './contract-wizard';
import { nextFieldId } from './field-canvas';
import type { SignFieldDraft, WizardPreload } from './wizard-context';

/**
 * Rehydrate a template's stored field layout into wizard `SignFieldDraft`s. The
 * saved layout carries no client id (it's server JSON), so mint fresh ids the
 * canvas can address; geometry and recipient assignment are copied verbatim.
 */
function toFieldDrafts(fields: TemplateField[]): SignFieldDraft[] {
  return fields.map((f) => ({
    id: nextFieldId(),
    type: f.type,
    page: f.page,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    recipientIndex: f.recipientIndex,
  }));
}

/**
 * Prepare a template for the wizard: load its detail, re-register its PDF as a
 * fresh DRAFT and reload the source bytes (in parallel), and hydrate the field
 * layout. Rejects with the server's Korean copy on failure.
 */
async function prepareTemplate(id: string): Promise<WizardPreload> {
  const template = await getTemplate(id);
  const [document, file] = await Promise.all([
    createDocumentFromStorageKey({
      storageKey: template.storageKey,
      title: template.name,
      ...(template.pageCount > 0 ? { pageCount: template.pageCount } : {}),
    }),
    fetchTemplateFile(id),
  ]);
  return { document, file, fields: toFieldDrafts(template.fields) };
}

type View =
  | { kind: 'choose' }
  | { kind: 'upload' }
  | { kind: 'pick' }
  | { kind: 'preparing' }
  | { kind: 'prepareError'; message: string }
  | { kind: 'ready'; preload: WizardPreload };

export function NewContractStart() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get('template');

  // A deep link (`?template=id`) skips the chooser and prepares straight away.
  const [view, setView] = React.useState<View>(
    deepLinkId ? { kind: 'preparing' } : { kind: 'choose' },
  );
  // The template id currently being prepared — kept so "다시 시도" can re-run it.
  const preparingIdRef = React.useRef<string | null>(deepLinkId);

  const goChoose = React.useCallback(() => {
    preparingIdRef.current = null;
    setView({ kind: 'choose' });
  }, []);

  const prepare = React.useCallback(
    async (id: string) => {
      preparingIdRef.current = id;
      setView({ kind: 'preparing' });
      try {
        const preload = await prepareTemplate(id);
        setView({ kind: 'ready', preload });
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          router.replace('/login');
          return;
        }
        setView({
          kind: 'prepareError',
          message: err instanceof ApiError ? err.message : GENERIC_ERROR,
        });
      }
    },
    [router],
  );

  // Kick off the deep-link prepare exactly once.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (deepLinkId && !started.current) {
      started.current = true;
      void prepare(deepLinkId);
    }
  }, [deepLinkId, prepare]);

  switch (view.kind) {
    case 'upload':
      // From-scratch path — unchanged wizard, no preload.
      return <ContractWizard />;
    case 'ready':
      return <ContractWizard preload={view.preload} />;
    case 'preparing':
      return (
        <StartShell>
          <PreparingState />
        </StartShell>
      );
    case 'prepareError':
      return (
        <StartShell>
          <PrepareErrorState
            message={view.message}
            onRetry={() => {
              const id = preparingIdRef.current;
              if (id) void prepare(id);
            }}
            onStartOver={goChoose}
          />
        </StartShell>
      );
    case 'pick':
      return (
        <StartShell>
          <TemplatePicker
            onBack={goChoose}
            onSelect={(t) => void prepare(t.id)}
            onUpload={() => setView({ kind: 'upload' })}
          />
        </StartShell>
      );
    case 'choose':
    default:
      return (
        <StartShell>
          <StartChoice
            onUpload={() => setView({ kind: 'upload' })}
            onFromTemplate={() => setView({ kind: 'pick' })}
          />
        </StartShell>
      );
  }
}

/** Centered page shell shared by every pre-wizard view. */
function StartShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-md py-sm">
          <span className="text-base font-bold tracking-tight text-primary">전자계약</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/dashboard')}
            aria-label="계약 생성 나가기"
          >
            나가기
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-md py-2xl">{children}</main>
    </div>
  );
}

/** The two start options. */
function StartChoice({
  onUpload,
  onFromTemplate,
}: {
  onUpload: () => void;
  onFromTemplate: () => void;
}) {
  return (
    <div className="flex flex-col gap-xl">
      <div className="flex flex-col gap-2xs">
        <h1 className="text-2xl font-bold text-foreground">{COPY.chooseTitle}</h1>
        <p className="text-base text-foreground-subtle">{COPY.chooseSubtitle}</p>
      </div>
      <div className="grid gap-md sm:grid-cols-2">
        <ChoiceCard
          title={COPY.uploadTitle}
          body={COPY.uploadBody}
          onClick={onUpload}
          icon={<UploadIcon />}
        />
        <ChoiceCard
          title={COPY.fromTemplateTitle}
          body={COPY.fromTemplateBody}
          onClick={onFromTemplate}
          icon={<TemplateIcon />}
        />
      </div>
    </div>
  );
}

/**
 * start-choice-card — one big start option (design-spec
 * `components/start-choice-card/base.md`): an interactive Card with an icon tile,
 * a bold title, and a muted one-line body. The whole card is the button.
 */
function ChoiceCard({
  title,
  body,
  onClick,
  icon,
}: {
  title: string;
  body: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block h-full w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus"
    >
      <Card interactive className="flex h-full flex-col gap-md p-lg">
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-subtle text-primary">
          {icon}
        </span>
        <div className="flex flex-col gap-2xs">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="text-sm text-foreground-subtle">{body}</p>
        </div>
      </Card>
    </button>
  );
}

/** Template-selection view: title + back, then the picker list / states. */
function TemplatePicker({
  onBack,
  onSelect,
  onUpload,
}: {
  onBack: () => void;
  onSelect: (template: TemplateSummary) => void;
  onUpload: () => void;
}) {
  const router = useRouter();
  const [templates, setTemplates] = React.useState<TemplateSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    }
  }, [router]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-xl">
      <div className="flex flex-col gap-2xs">
        <h1 className="text-2xl font-bold text-foreground">{COPY.pickTitle}</h1>
        <p className="text-base text-foreground-subtle">{COPY.pickSubtitle}</p>
      </div>

      <section aria-label={COPY.listLabel}>
        <PickerBody
          templates={templates}
          error={error}
          onRetry={() => void load()}
          onSelect={onSelect}
          onUpload={onUpload}
        />
      </section>

      <div>
        <Button variant="ghost" size="md" onClick={onBack}>
          {COPY.pickBack}
        </Button>
      </div>
    </div>
  );
}

function PickerBody({
  templates,
  error,
  onRetry,
  onSelect,
  onUpload,
}: {
  templates: TemplateSummary[] | null;
  error: string | null;
  onRetry: () => void;
  onSelect: (template: TemplateSummary) => void;
  onUpload: () => void;
}) {
  if (error && !templates) {
    return (
      <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
        <p className="text-base text-foreground-muted">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          {COPY.retry}
        </Button>
      </Card>
    );
  }
  if (templates === null) {
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
  if (templates.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
        <div className="flex flex-col gap-2xs">
          <h2 className="text-lg font-bold text-foreground">{COPY.emptyTitle}</h2>
          <p className="max-w-[380px] text-base text-foreground-subtle">{COPY.emptyBody}</p>
        </div>
        <Button size="lg" onClick={onUpload}>
          {COPY.emptyCta}
        </Button>
      </Card>
    );
  }
  return (
    <ul className="motion-stagger flex flex-col gap-sm">
      {templates.map((template, i) => (
        <li
          key={template.id}
          style={{ ['--stagger-index' as string]: Math.min(i, 12) } as React.CSSProperties}
        >
          <TemplateCard
            template={template}
            onSelect={onSelect}
            selectLabel={COPY.selectLabel(template.name)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Spinner + copy while the chosen template is re-registered and reloaded. */
function PreparingState() {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <Spinner />
      <div className="flex flex-col gap-2xs">
        <h1 className="text-lg font-bold text-foreground">{COPY.preparingTitle}</h1>
        <p className="max-w-[380px] text-base text-foreground-subtle">{COPY.preparingBody}</p>
      </div>
    </Card>
  );
}

function PrepareErrorState({
  message,
  onRetry,
  onStartOver,
}: {
  message: string;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-md px-lg py-3xl text-center">
      <p className="max-w-[420px] text-base text-foreground-muted" role="alert">
        {message}
      </p>
      <div className="flex items-center gap-xs">
        <Button variant="secondary" onClick={onStartOver}>
          {COPY.startOver}
        </Button>
        <Button onClick={onRetry}>{COPY.retry}</Button>
      </div>
    </Card>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8 animate-spin text-primary" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 13h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
