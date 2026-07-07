-- AI-generated key-clause summary for the signer/share reading experience.
-- Nullable JSONB: null means no summary yet or generation failed, in which case
-- the reader gracefully falls back to the plain original-document viewer.
-- Shape mirrors the `ClauseSummary` TS type exported from `@repo/db`.
-- AlterTable
ALTER TABLE "documents" ADD COLUMN "clause_summary" JSONB;
