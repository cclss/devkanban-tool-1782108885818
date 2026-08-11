-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "scheduled_job_id" TEXT,
ADD COLUMN     "scheduled_send_at" TIMESTAMP(3);
