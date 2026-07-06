-- Completion post-processing outputs on documents (grain-5).
-- Adds the signed final-PDF key, the audit-certificate key, and the completion
-- timestamp (which also serves as the post-processing idempotency marker).
ALTER TABLE "documents"
  ADD COLUMN "signed_storage_key" TEXT,
  ADD COLUMN "certificate_storage_key" TEXT,
  ADD COLUMN "completed_at" TIMESTAMP(3);
