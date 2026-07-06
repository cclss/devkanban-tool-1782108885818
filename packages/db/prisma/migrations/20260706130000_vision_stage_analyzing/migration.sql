-- AI auto-field analysis: persist an in-progress marker on upload (grain-2).
-- Adds an ANALYZING lifecycle value to VisionStage so a document can record
-- "background analysis triggered, not finished yet" from the instant the row is
-- created. This is distinct from a terminal "analyzed, found nothing" (NOT_NEEDED
-- with zero suggestions), letting the editor keep a calm "분석 중" notice and poll
-- until a terminal stage lands instead of falsely reporting no suggestions.

-- AlterEnum
ALTER TYPE "VisionStage" ADD VALUE 'ANALYZING';
