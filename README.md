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

## 배포 시 필수 시크릿

로컬 개발은 `.env.example`의 `dev-local-*-change-me` 기본값으로 바로 동작한다.
**공유/프로덕션 환경에서는 아래 시크릿을 반드시 강한 값으로 설정한다.** 미설정 시
`NODE_ENV=production`으로 기동하면 부팅 로그에 `ProductionSecrets` 경고가 출력된다
(기동을 막지는 않으며, 개발용 공개 기본값으로 세션 토큰이 서명되니 반드시 교체).

| 변수 | 용도 | 미설정 시 |
|---|---|---|
| `JWT_SECRET` | 발송자(sender) 대시보드 로그인 JWT 서명 | dev 기본값 fallback → prod 경고 |
| `SHARE_JWT_SECRET` | 수신자 공유 링크 세션 토큰 서명 (sender JWT와 격리) | dev 기본값 fallback → prod 경고 |
| `SIGNER_JWT_SECRET` | 인증번호 검증 후 서명자 세션 토큰 서명 (sender/share와 격리) | dev 기본값 fallback → prod 경고 |
| `SHARE_LINK_ENCRYPTION_KEY` | 공유 링크 비밀번호 DB 저장 시 AES-256-GCM 암호화 키 | dev 기본값 fallback → prod 경고 |

세 JWT 시크릿은 **서로 다른 값**을 써야 한다 — 그래야 한 토큰이 다른 용도로
교차 사용될 수 없다.

### origin 변수 (CORS·링크 생성)

서명자가 공유 링크로 접속했을 때 인증/PDF 로딩이 동작하려면 아래 두 값이 실제
배포 도메인과 정확히 일치해야 한다.

| 변수 | 용도 | 기본값(dev) |
|---|---|---|
| `WEB_ORIGIN` | API 서버 CORS 허용 origin + 서버가 만드는 링크의 호스트 | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | 브라우저가 API를 호출하는 base URL | `http://localhost:3001` |

> 시크릿 실값은 저장소에 커밋하지 않는다 — 배포 환경의 시크릿 매니저/환경 변수로만 주입.

## 비고

- 애니메이션은 `framer-motion` 없이 CSS `transition`/`animation`만 사용한다.
- AWS S3 / SES, 카카오 알림톡 연동은 환경 변수 미설정 시 콘솔 로그로 대체되도록 후속 그레인에서 스텁을 채운다.
