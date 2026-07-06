import { SignFieldType } from '@repo/db';
import { FieldAnalysisService } from './field-analysis.service';
import type { FieldDetectionService } from '../field-detection/field-detection.service';
import type { VisionDetectionService } from '../vision-detection/vision-detection.service';
import type { PdfPageRenderer } from './pdf-page-renderer';
import type {
  FieldCandidate,
  FieldDetectionResult,
} from '../field-detection/field-detection.types';
import type {
  VisionEngineResult,
  VisionPageImage,
} from '../vision-detection/vision-detection.types';

/**
 * Unit tests for the auto-field-placement analysis orchestration (grain-3).
 *
 * The two composed engine grains and the page renderer are replaced with
 * hand-authored fakes so the branch logic — heuristic-only, Vision fallback, and
 * the failed path — is exercised in isolation with no Nest app or database. The
 * behaviours asserted are the ones the grain's Done criteria call out: engine
 * selection (text → no Vision; image-only → Vision), and a Vision failure
 * returning empty candidates plus a structured reason. Trial/upgrade fields are
 * intentionally out of scope for this grain and absent from the payload.
 */

const PDF = Buffer.from('%PDF-1.7 fake');

function candidate(type: SignFieldType): FieldCandidate {
  return {
    type,
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.05,
    confidence: 0.9,
    anchorText: '서명',
  };
}

function heuristicOk(): FieldDetectionResult {
  return {
    engine: 'heuristic',
    signal: 'ok',
    fields: [candidate(SignFieldType.SIGNATURE)],
    meanConfidence: 0.9,
    fallbackToVision: false,
  };
}

function heuristicNoText(): FieldDetectionResult {
  return {
    engine: 'heuristic',
    signal: 'no-text',
    fields: [],
    meanConfidence: null,
    fallbackToVision: true,
  };
}

function heuristicLowConfidence(): FieldDetectionResult {
  return {
    engine: 'heuristic',
    signal: 'low-confidence',
    fields: [candidate(SignFieldType.TEXT)],
    meanConfidence: 0.3,
    fallbackToVision: true,
  };
}

function visionOk(): FieldDetectionResult {
  return {
    engine: 'vision',
    signal: 'ok',
    fields: [candidate(SignFieldType.DATE), candidate(SignFieldType.SIGNATURE)],
    meanConfidence: 0.8,
    fallbackToVision: false,
  };
}

const PAGE_IMAGE: VisionPageImage = {
  page: 1,
  width: 595,
  height: 842,
  mimeType: 'image/png',
  image: Buffer.from('png-bytes'),
};

interface Fakes {
  detection: FieldDetectionResult;
  vision: VisionEngineResult;
  pages: VisionPageImage[];
}

function makeService(overrides: Partial<Fakes> = {}) {
  const cfg: Fakes = {
    detection: heuristicOk(),
    vision: { ok: true, result: visionOk() },
    pages: [PAGE_IMAGE],
    ...overrides,
  };

  const fieldDetection = {
    analyze: jest.fn(async () => cfg.detection),
  } as unknown as FieldDetectionService;

  const visionDetection = {
    analyze: jest.fn(async () => cfg.vision),
  } as unknown as VisionDetectionService;

  const renderer: PdfPageRenderer = { render: jest.fn(async () => cfg.pages) };

  const service = new FieldAnalysisService(
    fieldDetection,
    visionDetection,
    renderer,
  );

  return { service, fieldDetection, visionDetection, renderer };
}

describe('FieldAnalysisService', () => {
  describe('text PDF (heuristic confident)', () => {
    it('returns heuristic candidates and never renders pages or calls Vision', async () => {
      const { service, visionDetection, renderer } = makeService({
        detection: heuristicOk(),
      });

      const { fields, status } = await service.analyze(PDF);

      expect(status.engine).toBe('heuristic');
      expect(status.signal).toBe('ok');
      expect(status.visionStage).toBe('not-needed');
      expect(status.visionError).toBeUndefined();
      expect(fields.map((f) => f.type)).toEqual([SignFieldType.SIGNATURE]);

      expect(renderer.render).not.toHaveBeenCalled();
      expect(visionDetection.analyze).not.toHaveBeenCalled();
    });

    it('carries no trial/upgrade fields in the status payload', async () => {
      const { service } = makeService({ detection: heuristicOk() });

      const { status } = await service.analyze(PDF);

      // This grain excludes trial gating; the payload must not leak trial state.
      expect(Object.keys(status).sort()).toEqual(
        ['engine', 'signal', 'visionStage'].sort(),
      );
    });
  });

  describe('image-only / low-confidence PDF (Vision fallback)', () => {
    it('runs Vision on an image-only PDF and returns the Vision candidates', async () => {
      const { service, visionDetection, renderer } = makeService({
        detection: heuristicNoText(),
      });

      const { fields, status } = await service.analyze(PDF);

      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(visionDetection.analyze).toHaveBeenCalledTimes(1);
      expect(status.engine).toBe('vision');
      expect(status.visionStage).toBe('succeeded');
      expect(status.visionError).toBeUndefined();
      expect(fields).toHaveLength(2);
    });

    it('also falls back to Vision on a low-confidence text result', async () => {
      const { service, visionDetection } = makeService({
        detection: heuristicLowConfidence(),
      });

      const { status } = await service.analyze(PDF);

      expect(visionDetection.analyze).toHaveBeenCalledTimes(1);
      expect(status.engine).toBe('vision');
      expect(status.visionStage).toBe('succeeded');
    });
  });

  describe('image-only PDF, Vision fails', () => {
    it('returns empty candidates and the structured reason when the engine fails', async () => {
      const { service } = makeService({
        detection: heuristicNoText(),
        vision: { ok: false, error: { reason: 'timeout', detail: '15000ms 초과' } },
      });

      const { fields, status } = await service.analyze(PDF);

      expect(status.engine).toBe('heuristic');
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('timeout');
      expect(fields).toEqual([]);
    });

    it('treats an unbound renderer (no page images) as an unavailable Vision path', async () => {
      const { service, visionDetection } = makeService({
        detection: heuristicNoText(),
        pages: [],
      });

      const { fields, status } = await service.analyze(PDF);

      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('unavailable');
      expect(fields).toEqual([]);
    });
  });

  describe('analyzeInBackground', () => {
    it('runs analysis without throwing and swallows loader failures', async () => {
      const { service, fieldDetection } = makeService({ detection: heuristicOk() });
      const analyzeSpy = jest.spyOn(service, 'analyze');

      // Successful background run.
      service.analyzeInBackground('doc-1', async () => PDF);
      await flush();
      expect(analyzeSpy).toHaveBeenCalledWith(PDF);

      // A failing byte loader must not throw out of the fire-and-forget call.
      analyzeSpy.mockClear();
      expect(() =>
        service.analyzeInBackground('doc-2', async () => {
          throw new Error('storage down');
        }),
      ).not.toThrow();
      await flush();
      expect(analyzeSpy).not.toHaveBeenCalled();
      expect(fieldDetection.analyze).toHaveBeenCalledTimes(1); // only the first run
    });
  });
});

/** Let queued microtasks (the fire-and-forget background run) settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
