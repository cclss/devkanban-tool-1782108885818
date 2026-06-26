-- Sign-field provenance + "발송 준비 완료(READY)" document status (grain-2).
--
-- Persists how each confirmed sign field came to be (AI-as-is vs hand-placed/
-- adjusted), its internal confidence score, and the confirmation timestamp, plus
-- a new READY status so a document whose fields are confirmed is marked ready to
-- send without yet being dispatched. All additive + defaulted → existing rows
-- stay valid (source = MANUAL, confidence/confirmed_at = NULL).

-- CreateEnum
CREATE TYPE "SignFieldSource" AS ENUM ('AI', 'MANUAL');

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'READY' BEFORE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "sign_fields"
  ADD COLUMN "source" "SignFieldSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "confirmed_at" TIMESTAMP(3);
