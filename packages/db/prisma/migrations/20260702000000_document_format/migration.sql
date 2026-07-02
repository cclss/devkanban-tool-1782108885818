-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('PDF', 'DOCX');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "format" "DocumentFormat" NOT NULL DEFAULT 'PDF';
ALTER TABLE "documents" ADD COLUMN "mime_type" TEXT;
