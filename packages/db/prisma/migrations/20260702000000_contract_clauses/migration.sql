-- AI clause-card persistence (M1 / grain-1).
-- Adds the ContractClause table plus the extraction-pipeline state columns on
-- documents. clause_status distinguishes READY (cards present) from EMPTY
-- (extraction succeeded, zero cards) so the signer UI can decide when to fall
-- back to the full-PDF view.

-- CreateEnum
CREATE TYPE "ClauseExtractionStatus" AS ENUM ('PENDING', 'READY', 'EMPTY', 'FAILED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "clause_status" "ClauseExtractionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "clause_extracted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contract_clauses" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source_page" INTEGER NOT NULL,
    "source_snippet" TEXT,
    "caution" BOOLEAN NOT NULL DEFAULT false,
    "caution_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_clauses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_clauses_document_id_idx" ON "contract_clauses"("document_id");

-- AddForeignKey
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
