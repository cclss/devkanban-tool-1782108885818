-- AlterEnum
-- Adds the `TEAM` tier to the Plan enum. Branding editing is gated to Team+
-- plans (TEAM, ENTERPRISE) by the entitlements helper. (Postgres appends the
-- value; enum sort order is not significant — the gate uses an explicit set.)
ALTER TYPE "Plan" ADD VALUE 'TEAM';

-- AlterTable
-- Selected brand font (catalog key). Logo & color branding columns already exist.
ALTER TABLE "users" ADD COLUMN     "brand_font" TEXT;
