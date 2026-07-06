import { Injectable } from '@nestjs/common';
import {
  AnalysisEngine as DbAnalysisEngine,
  Prisma,
  VisionStage as DbVisionStage,
} from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import type { FieldCandidate } from '../field-detection/field-detection.types';
import type { AnalysisEngine, VisionStage } from './field-analysis.types';

/**
 * The grain-1 persistence store for one document's auto-field analysis: the
 * proposed candidates plus the engine / Vision-stage state. Kept behind a port so
 * the orchestration ({@link FieldAnalysisService}) can be unit-tested with a fake
 * and the concrete Prisma writes live in one place.
 */
export interface FieldAnalysisStore {
  /**
   * Replace the stored analysis for a document: overwrite its `FieldSuggestion`
   * rows with `fields` and stamp the `Document` analysis columns
   * (`analysisEngine`, `visionStage`, `analyzedAt`). Idempotent per document — a
   * later run (e.g. premium after consent) supersedes the earlier snapshot.
   */
  saveAnalysis(documentId: string, snapshot: PersistedAnalysis): Promise<void>;
}

/** A single analysis snapshot to persist. */
export interface PersistedAnalysis {
  /** Which engine produced `fields`. */
  engine: AnalysisEngine;
  /** The (possibly gating) Vision-stage state for this snapshot. */
  visionStage: VisionStage;
  /** Proposed candidates (may be empty — awaiting/blocked/failed runs). */
  fields: FieldCandidate[];
}

/** DI token for the {@link FieldAnalysisStore} binding. */
export const FIELD_ANALYSIS_STORE = Symbol('FIELD_ANALYSIS_STORE');

/** Wire engine value → persisted `AnalysisEngine` enum. */
const ENGINE_MAP: Record<AnalysisEngine, DbAnalysisEngine> = {
  heuristic: DbAnalysisEngine.HEURISTIC,
  vision: DbAnalysisEngine.VISION,
};

/** Wire stage value → persisted `VisionStage` enum (the two gating states map to
 * `AWAITING_CONSENT` / `BLOCKED`). */
const STAGE_MAP: Record<VisionStage, DbVisionStage> = {
  'not-needed': DbVisionStage.NOT_NEEDED,
  available: DbVisionStage.AWAITING_CONSENT,
  blocked: DbVisionStage.BLOCKED,
  succeeded: DbVisionStage.SUCCEEDED,
  failed: DbVisionStage.FAILED,
};

/**
 * Prisma-backed {@link FieldAnalysisStore}. Writes the suggestions and the
 * document status atomically in one transaction so a reader never sees candidates
 * that disagree with the stored engine/stage.
 */
@Injectable()
export class PrismaFieldAnalysisStore implements FieldAnalysisStore {
  constructor(private readonly prisma: PrismaService) {}

  async saveAnalysis(
    documentId: string,
    snapshot: PersistedAnalysis,
  ): Promise<void> {
    const rows: Prisma.FieldSuggestionCreateManyInput[] = snapshot.fields.map(
      (f) => ({
        documentId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        confidence: f.confidence,
        anchorText: f.anchorText,
      }),
    );

    await this.prisma.$transaction([
      this.prisma.fieldSuggestion.deleteMany({ where: { documentId } }),
      ...(rows.length
        ? [this.prisma.fieldSuggestion.createMany({ data: rows })]
        : []),
      this.prisma.document.update({
        where: { id: documentId },
        data: {
          analysisEngine: ENGINE_MAP[snapshot.engine],
          visionStage: STAGE_MAP[snapshot.visionStage],
          analyzedAt: new Date(),
        },
      }),
    ]);
  }
}
