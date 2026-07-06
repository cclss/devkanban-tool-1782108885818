'use client';

import * as React from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Confetti,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  StepIndicator,
  SuccessCheck,
} from '@repo/ui';
import { AiSuggestionBadge } from '@/components/ai/ai-suggestion-badge';
import { AI_COPY } from '@/lib/ai-copy';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-md">
      <div className="flex flex-col gap-2xs">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {hint ? <p className="text-sm text-foreground-subtle">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

const TOKEN_SWATCHES: { name: string; className: string; ring?: boolean }[] = [
  { name: 'background', className: 'bg-background', ring: true },
  { name: 'surface', className: 'bg-surface', ring: true },
  { name: 'surface-muted', className: 'bg-surface-muted', ring: true },
  { name: 'primary', className: 'bg-primary' },
  { name: 'primary-hover', className: 'bg-primary-hover' },
  { name: 'primary-subtle', className: 'bg-primary-subtle', ring: true },
  { name: 'success', className: 'bg-success' },
  { name: 'danger', className: 'bg-danger' },
  { name: 'warning', className: 'bg-warning' },
  { name: 'foreground', className: 'bg-foreground' },
  { name: 'foreground-muted', className: 'bg-foreground-muted' },
  { name: 'border', className: 'bg-border', ring: true },
  { name: 'ai', className: 'bg-ai' },
  { name: 'ai-strong', className: 'bg-ai-strong' },
  { name: 'ai-subtle', className: 'bg-ai-subtle', ring: true },
];

const TYPE_SCALE = ['display', '3xl', '2xl', 'xl', 'lg', 'md', 'base', 'sm', 'xs', '2xs'] as const;
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
const SHADOWS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

const STEPS = ['문서 업로드', '서명란 배치', '수신자 입력', '발송'];

export default function DesignSystemPage() {
  const [step, setStep] = React.useState(1);
  const [celebrate, setCelebrate] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Re-mount the success block so the stroke-draw + confetti replay on demand.
  const replay = () => {
    setCelebrate(false);
    setReloadKey((k) => k + 1);
    requestAnimationFrame(() => setCelebrate(true));
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-3xl px-lg py-2xl">
      <header className="flex flex-col gap-xs">
        <p className="text-sm font-semibold text-primary">Design System</p>
        <h1 className="text-3xl font-bold text-foreground">토스 스타일 디자인 시스템 데모</h1>
        <p className="text-base text-foreground-muted">
          토큰 · 모션 · 코어 프리미티브. 모든 모션은 시스템의 <code>prefers-reduced-motion</code>{' '}
          설정을 따르며, 줄임 모드에서는 정적 폴백으로 전환됩니다.
        </p>
      </header>

      <Section title="Color tokens" hint="시맨틱 색상 토큰. 값은 CSS 변수에서 옵니다.">
        <div className="grid grid-cols-2 gap-md sm:grid-cols-3 md:grid-cols-4">
          {TOKEN_SWATCHES.map((s) => (
            <div key={s.name} className="flex items-center gap-xs">
              <span
                className={`h-10 w-10 rounded-md ${s.className} ${s.ring ? 'ring-1 ring-inset ring-border' : ''}`}
              />
              <span className="text-sm text-foreground-muted">{s.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="AI 제안"
        hint="AI가 제안한 요소를 사람이 만든 요소와 구분하는 시각 언어. violet ai 액센트 + 스파클 글리프 + 라벨(색만으로 의미를 전달하지 않음)."
      >
        <div className="flex flex-wrap items-center gap-md">
          <AiSuggestionBadge />
          <AiSuggestionBadge tone="solid" />
        </div>
        {/* Sample AI-suggested field marker — the field-box tint/border the
            editor (grain-6) will apply, shown here on a neutral surface. */}
        <div className="flex flex-wrap gap-md pt-md">
          <div className="relative flex h-16 w-56 items-center justify-center rounded-sm border-2 border-dashed border-ai bg-ai-subtle text-sm font-semibold text-ai-strong">
            서명란
            <span className="absolute -right-2.5 -top-2.5">
              <AiSuggestionBadge className="shadow-sm" />
            </span>
          </div>
        </div>
        <p className="pt-2xs text-sm text-foreground-muted">{AI_COPY.suggestion.placed(3)}</p>
      </Section>

      <Section title="Typography" hint="Pretendard 기반 타입 스케일">
        <div className="flex flex-col gap-xs">
          {TYPE_SCALE.map((size) => (
            <div key={size} className="flex items-baseline gap-md">
              <span className="w-16 shrink-0 text-xs text-foreground-subtle">{size}</span>
              <span className={`text-${size} font-semibold text-foreground`}>
                다람쥐 헌 쳇바퀴에 타고파 Aa 123
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius & Elevation">
        <div className="flex flex-wrap gap-lg">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2xs">
              <span className={`h-16 w-16 rounded-${r} bg-primary-subtle ring-1 ring-inset ring-border`} />
              <span className="text-xs text-foreground-subtle">radius {r}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-lg pt-md">
          {SHADOWS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2xs">
              <span className={`h-16 w-16 rounded-lg bg-surface shadow-${s}`} />
              <span className="text-xs text-foreground-subtle">shadow {s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button" hint="hover 색 전환 + active 시 scale 프레스(탭 피드백)">
        <div className="flex flex-wrap items-center gap-md">
          <Button variant="primary">기본</Button>
          <Button variant="secondary">보조</Button>
          <Button variant="ghost">고스트</Button>
          <Button variant="danger">위험</Button>
          <Button isLoading>발송 중</Button>
          <Button disabled>비활성</Button>
        </div>
        <div className="flex flex-wrap items-center gap-md">
          <Button size="sm">small</Button>
          <Button size="md">medium</Button>
          <Button size="lg">large</Button>
        </div>
      </Section>

      <Section title="Input & Field" hint="라벨 · 도움말 · 에러 상태 / 포커스 링(WCAG AA)">
        <div className="grid gap-lg sm:grid-cols-2">
          <Field label="이메일" htmlFor="demo-email" hint="수신자에게 서명 요청이 발송됩니다." required>
            <Input id="demo-email" type="email" placeholder="name@company.com" />
          </Field>
          <Field label="이름" htmlFor="demo-name" error="이름을 입력해 주세요." required>
            <Input id="demo-name" invalid placeholder="홍길동" />
          </Field>
        </div>
      </Section>

      <Section title="Card" hint="interactive 카드는 hover 시 lift(상승 + 그림자 심화)">
        <div className="grid gap-md sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>정적 카드</CardTitle>
              <CardDescription>기본 surface 카드입니다.</CardDescription>
            </CardHeader>
            <CardContent className="text-base text-foreground-muted">콘텐츠 영역</CardContent>
          </Card>
          <Card interactive>
            <CardHeader>
              <CardTitle>인터랙티브 카드</CardTitle>
              <CardDescription>마우스를 올려보세요 — hover lift.</CardDescription>
            </CardHeader>
            <CardContent className="text-base text-foreground-muted">대시보드 항목 등에 사용</CardContent>
          </Card>
        </div>
      </Section>

      <Section title="StepIndicator" hint="활성 단계 진입 시 bounce, 완료 단계는 체크마크">
        <Card>
          <CardContent className="pt-lg">
            <StepIndicator steps={STEPS} current={step} />
            <div className="flex justify-between pt-lg">
              <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                이전
              </Button>
              <Button
                size="sm"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                다음
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Skeleton" hint="shimmer 로딩 플레이스홀더">
        <Card>
          <CardContent className="flex items-center gap-md pt-lg">
            <Skeleton shape="circle" className="h-12 w-12" />
            <div className="flex flex-1 flex-col gap-xs">
              <Skeleton shape="text" className="w-1/2" />
              <Skeleton shape="text" className="w-3/4" />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Dialog & Sheet" hint="Radix 기반 — 포커스 트랩 · Esc/오버레이 닫기 · 진입/이탈 모션">
        <div className="flex flex-wrap gap-md">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Dialog 열기</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>계약을 발송할까요?</DialogTitle>
                <DialogDescription>수신자에게 서명 요청 알림이 전송됩니다.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">취소</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>발송</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">BottomSheet 열기</Button>
            </SheetTrigger>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>서명 입력</SheetTitle>
                <SheetDescription>모바일 서명자 플로우의 하단 시트입니다.</SheetDescription>
              </SheetHeader>
              <div className="flex h-32 items-center justify-center rounded-md bg-surface-muted text-foreground-subtle">
                서명 캔버스 영역
              </div>
              <SheetClose asChild>
                <Button fullWidth className="mt-md">
                  완료
                </Button>
              </SheetClose>
            </SheetContent>
          </Sheet>
        </div>
      </Section>

      <Section title="Motion · 그래디언트 블롭" hint="배경에서 느리게 흐르는 블롭(18s 루프)">
        <div className="relative h-48 overflow-hidden rounded-xl bg-grey-900">
          <span className="absolute -left-10 top-0 h-40 w-40 animate-blob rounded-full bg-primary opacity-60 blur-2xl" />
          <span
            className="absolute right-0 top-6 h-44 w-44 animate-blob rounded-full bg-success opacity-50 blur-2xl"
            style={{ animationDelay: '-6s' }}
          />
          <span
            className="absolute bottom-0 left-1/3 h-36 w-36 animate-blob rounded-full bg-warning opacity-40 blur-2xl"
            style={{ animationDelay: '-12s' }}
          />
        </div>
      </Section>

      <Section title="Motion · stagger fadeIn" hint="리스트/텍스트가 순차적으로 등장">
        <ul key={`stagger-${reloadKey}`} className="motion-stagger flex flex-col gap-xs">
          {['계약서_2026.pdf', 'NDA_상호비밀유지.pdf', '용역계약_최종.pdf', '근로계약서.pdf'].map((doc) => (
            <li
              key={doc}
              className="rounded-md border border-border bg-surface px-md py-sm text-base text-foreground"
            >
              {doc}
            </li>
          ))}
        </ul>
        <div>
          <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            다시 재생
          </Button>
        </div>
      </Section>

      <Section
        title="Motion · 발송 완료 (체크마크 + confetti)"
        hint="발신자 발송 완료 시의 와우 모먼트"
      >
        <Card>
          <CardContent className="relative flex flex-col items-center gap-md overflow-visible py-2xl">
            {celebrate ? <Confetti key={`confetti-${reloadKey}`} /> : null}
            <div className="relative">
              {celebrate ? <SuccessCheck key={`check-${reloadKey}`} /> : <SuccessCheckPlaceholder />}
            </div>
            <p className="text-lg font-bold text-foreground">계약 발송이 완료되었습니다!</p>
            <Button onClick={replay}>이펙트 재생</Button>
          </CardContent>
        </Card>
      </Section>

      <Section title="Brand override hook" hint="발신자 브랜딩 색상으로 primary 토큰을 런타임 교체">
        <div
          className="rounded-xl border border-border p-lg"
          style={{
            // Sender branding override — only the brand hook is set; every
            // primary-colored child re-skins automatically.
            ['--brand-primary' as string]: '#7c3aed',
            ['--brand-primary-hover' as string]: '#6d28d9',
            ['--brand-primary-pressed' as string]: '#5b21b6',
            ['--brand-primary-subtle' as string]: '#f3e8ff',
          }}
        >
          <div className="flex flex-wrap items-center gap-md">
            <Button>브랜드 버튼</Button>
            <Button variant="secondary">보조</Button>
            <StepIndicator steps={['1', '2', '3']} current={1} className="max-w-xs" />
          </div>
        </div>
      </Section>
    </main>
  );
}

function SuccessCheckPlaceholder() {
  return <span className="block h-24 w-24 rounded-full bg-success-subtle" aria-hidden="true" />;
}
