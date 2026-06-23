import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Singleton PrismaClient.
 *
 * In development Next.js / Nest hot-reload can instantiate many clients and
 * exhaust the Postgres connection pool, so we cache the instance on
 * `globalThis`.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
