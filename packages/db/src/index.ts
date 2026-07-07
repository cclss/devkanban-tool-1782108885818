import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Emphasis level for a single summarized clause.
 *
 * - `normal`  — informational; no extra attention required.
 * - `caution` — a clause the signer should pay attention to (e.g. penalties,
 *   auto-renewal, liability). Rendered with a distinct treatment on the front
 *   end; the visual token mapping lives in the web layer, not here.
 *
 * The union is closed: only these two values are contractually allowed.
 */
export type ClauseEmphasis = 'normal' | 'caution';

/**
 * A single key clause extracted for the "summary-first" reading screen.
 */
export interface ClauseSummaryClause {
  /** Conversational, plain-language headline for the clause. */
  headline: string;
  /** Supporting explanation / detail for the clause. */
  detail: string;
  /** Clause category label (e.g. payment, term, liability). */
  category: string;
  /** How much attention this clause warrants. */
  emphasis: ClauseEmphasis;
  /** 1-based source page in the original document ("view in original" anchor). */
  sourcePage?: number;
}

/**
 * AI-generated key-clause summary stored on `Document.clauseSummary` (a raw
 * `Json?` column — there is no typed-json generator on the schema, so this type
 * is the shared contract the response layer reuses when reading/writing that
 * column). `null` on the document means "no summary" and the reader falls back
 * to the plain original-document viewer.
 */
export interface ClauseSummary {
  /** One-line gist of the whole contract. */
  oneLiner: string;
  /** The 3–5 key clauses, most relevant first. */
  clauses: ClauseSummaryClause[];
}

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
