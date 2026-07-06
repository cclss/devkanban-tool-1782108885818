import { SignFieldType } from '@repo/db';
import { FieldAnalysisService } from './field-analysis.service';
import type { FieldDetectionService } from '../field-detection/field-detection.service';
import type { VisionDetectionService } from '../vision-detection/vision-detection.service';
import type { VisionTrialService } from '../trials/vision-trial.service';
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
 * Unit tests for the tiered auto-field-placement orchestration (grain-4).
 *
 * The three composed grains are replaced with hand-authored fakes so the branch
 * logic — heuristic-only, Vision fallback, trial charging, and the blocked/failed
 * paths — is exercised in isolation with no Nest app or database. The key
 * behaviours asserted are the ones the grain's Done criteria call out: engine
 * selection, trial charge-on-success (never on failure/block), and the status
 * payload carrying engine / remaining trials / upgradeRequired.
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
  trial: {
    isPremium: boolean;
    remaining: number;
    allowed: boolean;
  };
}

function makeService(overrides: Partial<Fakes> = {}) {
  const cfg: Fakes = {
    detection: heuristicOk(),
    vision: { ok: true, result: visionOk() },
    pages: [PAGE_IMAGE],
    trial: { isPremium: false, remaining: 2, allowed: true },
    ...overrides,
  };

  const fieldDetection = {
    analyze: jest.fn(async () => cfg.detection),
  } as unknown as FieldDetectionService;

  const visionDetection = {
    analyze: jest.fn(async () => cfg.vision),
  } as unknown as VisionDetectionService;

  const consumeTrial = jest.fn(async () => ({
    consumed: cfg.trial.remaining > 0,
    remaining: Math.max(0, cfg.trial.remaining - 1),
  }));

  const trials = {
    getStatus: jest.fn(async () => ({
      plan: cfg.trial.isPremium ? 'PRO' : 'FREE',
      isPremium: cfg.trial.isPremium,
      used: 2 - cfg.trial.remaining,
      limit: 2,
      remaining: cfg.trial.remaining,
      exhausted: cfg.trial.remaining === 0,
    })),
    canUseVisionEngine: jest.fn(async () => ({
      allowed: cfg.trial.allowed,
      isPremium: cfg.trial.isPremium,
      remaining: cfg.trial.remaining,
      reason: cfg.trial.isPremium
        ? 'premium'
        : cfg.trial.allowed
          ? 'trial'
          : 'exhausted',
    })),
    consumeTrial,
  } as unknown as VisionTrialService;

  const renderer: PdfPageRenderer = { render: jest.fn(async () => cfg.pages) };

  const service = new FieldAnalysisService(
    fieldDetection,
    visionDetection,
    trials,
    renderer,
  );

  return { service, fieldDetection, visionDetection, trials, renderer, consumeTrial };
}

describe('FieldAnalysisService', () => {
  describe('text PDF (heuristic confident)', () => {
    it('returns heuristic candidates and never touches Vision or the trial meter', async () => {
      const { service, visionDetection, renderer, consumeTrial } = makeService({
        detection: heuristicOk(),
      });

      const { fields, status } = await service.analyze('u1', PDF);

      expect(status.engine).toBe('heuristic');
      expect(status.signal).toBe('ok');
      expect(status.visionStage).toBe('not-needed');
      expect(status.upgradeRequired).toBe(false);
      expect(status.trialConsumed).toBe(false);
      expect(status.trialsRemaining).toBe(2);
      expect(fields.map((f) => f.type)).toEqual([SignFieldType.SIGNATURE]);

      expect(renderer.render).not.toHaveBeenCalled();
      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(consumeTrial).not.toHaveBeenCalled();
    });
  });

  describe('image PDF, Vision available', () => {
    it('runs Vision, charges one trial for a FREE account, and returns Vision candidates', async () => {
      const { service, visionDetection, consumeTrial } = makeService({
        detection: heuristicNoText(),
        trial: { isPremium: false, remaining: 2, allowed: true },
      });

      const { fields, status } = await service.analyze('u1', PDF);

      expect(visionDetection.analyze).toHaveBeenCalledTimes(1);
      expect(consumeTrial).toHaveBeenCalledTimes(1);
      expect(status.engine).toBe('vision');
      expect(status.visionStage).toBe('succeeded');
      expect(status.trialConsumed).toBe(true);
      expect(status.trialsRemaining).toBe(1);
      expect(status.upgradeRequired).toBe(false);
      expect(fields).toHaveLength(2);
    });

    it('runs Vision for a premium account without consuming a trial', async () => {
      const { service, consumeTrial } = makeService({
        detection: heuristicNoText(),
        trial: { isPremium: true, remaining: 0, allowed: true },
      });

      const { status } = await service.analyze('u1', PDF);

      expect(consumeTrial).not.toHaveBeenCalled();
      expect(status.engine).toBe('vision');
      expect(status.visionStage).toBe('succeeded');
      expect(status.isPremium).toBe(true);
      expect(status.trialConsumed).toBe(false);
      expect(status.upgradeRequired).toBe(false);
    });
  });

  describe('image PDF, Vision blocked', () => {
    it('returns upgradeRequired without calling Vision or charging when trials are exhausted', async () => {
      const { service, visionDetection, renderer, consumeTrial } = makeService({
        detection: heuristicNoText(),
        trial: { isPremium: false, remaining: 0, allowed: false },
      });

      const { fields, status } = await service.analyze('u1', PDF);

      expect(status.engine).toBe('heuristic');
      expect(status.visionStage).toBe('blocked');
      expect(status.upgradeRequired).toBe(true);
      expect(status.trialsRemaining).toBe(0);
      expect(status.trialConsumed).toBe(false);
      expect(fields).toEqual([]);

      expect(renderer.render).not.toHaveBeenCalled();
      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(consumeTrial).not.toHaveBeenCalled();
    });
  });

  describe('image PDF, Vision fails', () => {
    it('does not charge a trial and reports the structured error when the engine fails', async () => {
      const { service, consumeTrial } = makeService({
        detection: heuristicNoText(),
        vision: { ok: false, error: { reason: 'timeout', detail: '15000ms 초과' } },
        trial: { isPremium: false, remaining: 2, allowed: true },
      });

      const { fields, status } = await service.analyze('u1', PDF);

      expect(consumeTrial).not.toHaveBeenCalled();
      expect(status.engine).toBe('heuristic');
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('timeout');
      expect(status.trialConsumed).toBe(false);
      expect(status.trialsRemaining).toBe(2);
      expect(status.upgradeRequired).toBe(false);
      expect(fields).toEqual([]);
    });

    it('treats an unbound renderer (no page images) as an unavailable Vision path, no charge', async () => {
      const { service, visionDetection, consumeTrial } = makeService({
        detection: heuristicNoText(),
        pages: [],
        trial: { isPremium: false, remaining: 2, allowed: true },
      });

      const { status } = await service.analyze('u1', PDF);

      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(consumeTrial).not.toHaveBeenCalled();
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('unavailable');
      expect(status.trialConsumed).toBe(false);
    });
  });

  describe('analyzeInBackground', () => {
    it('runs analysis without throwing and swallows loader failures', async () => {
      const { service, fieldDetection } = makeService({ detection: heuristicOk() });
      const analyzeSpy = jest.spyOn(service, 'analyze');

      // Successful background run.
      service.analyzeInBackground('u1', 'doc-1', async () => PDF);
      await flush();
      expect(analyzeSpy).toHaveBeenCalledWith('u1', PDF);

      // A failing byte loader must not throw out of the fire-and-forget call.
      analyzeSpy.mockClear();
      expect(() =>
        service.analyzeInBackground('u1', 'doc-2', async () => {
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
