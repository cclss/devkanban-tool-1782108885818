-- AI auto-field analysis persistence (grain-1).
-- Adds per-document analysis state and a staging table for AI-proposed fields
-- (pre-confirmation candidates), kept separate from the confirmed sign_fields.

-- CreateEnum
CREATE TYPE "AnalysisEngine" AS ENUM ('HEURISTIC', 'VISION');

-- CreateEnum
CREATE TYPE "VisionStage" AS ENUM ('NOT_NEEDED', 'AWAITING_CONSENT', 'BLOCKED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "FieldSuggestionSource" AS ENUM ('AI');

-- AlterTable: document analysis state. All three are nullable and default to
-- NULL, so every existing document backfills to "never analyzed".
ALTER TABLE "documents"
  ADD COLUMN "analysis_engine" "AnalysisEngine",
  ADD COLUMN "vision_stage" "VisionStage",
  ADD COLUMN "analyzed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "field_suggestions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "type" "SignFieldType" NOT NULL,
    "source" "FieldSuggestionSource" NOT NULL DEFAULT 'AI',
    "page" INTEGER NOT NULL DEFAULT 1,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "anchor_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_suggestions_document_id_idx" ON "field_suggestions"("document_id");

-- AddForeignKey
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
