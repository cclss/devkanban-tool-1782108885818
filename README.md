# 전자계약 SaaS — Monorepo

한국형 전자계약 SaaS MVP. Turborepo 기반 모노레포.

## 구성

| 위치 | 패키지 | 설명 |
|---|---|---|
| `apps/web` | `@repo/web` | Next.js 15 (App Router) + Tailwind CSS + Radix UI 프론트엔드 |
| `apps/api` | `@repo/api` | NestJS API 서버 (`/health` 헬스체크 포함) |
| `packages/db` | `@repo/db` | Prisma 스키마 + PostgreSQL 클라이언트 |
| `packages/ui` | `@repo/ui` | 공용 UI 프리미티브 (`cn` 헬퍼 등) |
| `packages/tsconfig` | `@repo/tsconfig` | 공유 TypeScript 설정 |
| `packages/eslint-config` | `@repo/eslint-config` | 공유 ESLint 설정 |

## 요구 사항

- Node.js >= 20
- pnpm 9 (`corepack enable` 또는 `npm i -g pnpm@9`)
- Docker (로컬 Postgres/Redis 용, 선택)

## 시작하기

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경 변수 준비
cp .env.example .env

# 3. 로컬 인프라 기동 (Postgres + Redis)
docker compose up -d

# 4. Prisma 클라이언트 생성 및 마이그레이션
pnpm db:generate
pnpm db:migrate

# 5. 개발 서버 동시 기동 (web + api)
pnpm dev
```

- web: http://localhost:3000
- api: http://localhost:3001 (health: http://localhost:3001/health)

## 주요 스크립트 (repo 루트)

| 명령 | 설명 |
|---|---|
| `pnpm dev` | turbo로 web/api 동시 기동 |
| `pnpm build` | 전체 빌드 |
| `pnpm lint` | 전체 린트 |
| `pnpm typecheck` | 전체 타입 체크 |
| `pnpm db:generate` | Prisma 클라이언트 생성 |
| `pnpm db:migrate` | Prisma 마이그레이션 (dev) |

## 비고

- 애니메이션은 `framer-motion` 없이 CSS `transition`/`animation`만 사용한다.
- AWS S3 / SES, 카카오 알림톡 연동은 환경 변수 미설정 시 콘솔 로그로 대체되도록 후속 그레인에서 스텁을 채운다.
