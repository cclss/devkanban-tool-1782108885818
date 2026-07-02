-- Record the originally-uploaded source format and preserve the original bytes
-- when a DOCX is converted to a canonical PDF. `storage_key`/`format` now refer
-- to the canonical PDF that every downstream step consumes.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "source_format" "DocumentFormat" NOT NULL DEFAULT 'PDF';
ALTER TABLE "documents" ADD COLUMN "source_storage_key" TEXT;
