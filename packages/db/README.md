# @repo/db

Prisma schema and PostgreSQL client for the platform.

## Usage

```ts
import { prisma } from '@repo/db';

const users = await prisma.user.findMany();
```

## Commands

Run from the repo root or this package:

```bash
pnpm --filter @repo/db db:generate   # generate the Prisma client
pnpm --filter @repo/db db:migrate    # create + apply a dev migration
pnpm --filter @repo/db db:push       # push schema without a migration
pnpm --filter @repo/db db:studio     # open Prisma Studio
```

`DATABASE_URL` must be set (see the repo-root `.env.example`).
