import { SignFieldType } from '@repo/db';
import { FieldAnalysisService } from './field-analysis.service';
import type { FieldDetectionService } from '../field-detection/field-detection.service';
import type { VisionDetectionService } from '../vision-detection/vision-detection.service';
import type { VisionTrialService } from '../trials/vision-trial.service';
import type { PdfPageRenderer } from './pdf-page-renderer';
import type {
  FieldAnalysisStore,
  PersistedAnalysis,
} from './field-analysis.store';
import type { DocumentPdfSource } from './document-pdf-source';
import type {
  FieldCandidate,
  FieldDetectionResult,
} from '../field-detection/field-detection.types';
import type {
  VisionEngineResult,
  VisionPageImage,
} from '../vision-detection/vision-detection.types';

/**
 * Unit tests for the analysis orchestration. Premium auto-placement is
 * **unlimited for every plan** — no trial is consumed and nothing is blocked.
 *
 * Every collaborator (both engines, the page renderer, the trial policy, the
 * persistence store, and the PDF source) is replaced with a hand-authored fake so
 * the branch logic runs with no Nest app or database. The behaviours asserted are
 * the ones the grain's Done criteria call out:
 *   • upload persists the heuristic result;
 *   • a scanned PDF is stored awaiting consent WITHOUT running Vision, and ALWAYS
 *     resolves to `available` (never `blocked`), with `upgradeRequired: false`;
 *   • the status payload carries isPremium / trialsRemaining / upgradeRequired;
 *   • runPremiumAnalysis never consumes a trial and never blocks — it runs +
 *     persists Vision for a FREE account an unlimited number of times.
 */

const PDF = Buffer.from('%PDF-1.7 fake');
const DOC = 'doc-1';
const USER = 'user-1';

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

type TrialStatus = Awaited<ReturnType<VisionTrialService['getStatus']>>;
type Availability = Awaited<ReturnType<VisionTrialService['canUseVisionEngine']>>;
type Acquisition = Awaited<ReturnType<VisionTrialService['acquireVisionUse']>>;

interface Fakes {
  detection: FieldDetectionResult;
  vision: VisionEngineResult;
  pages: VisionPageImage[];
  status: TrialStatus;
  access: Availability;
  acquire: Acquisition;
  pdf: Buffer | null;
}

function makeService(overrides: Partial<Fakes> = {}) {
  const cfg: Fakes = {
    detection: heuristicOk(),
    vision: { ok: true, result: visionOk() },
    pages: [PAGE_IMAGE],
    status: {
      plan: 'FREE',
      isPremium: false,
      used: 0,
      limit: 2,
      remaining: 2,
      exhausted: false,
    } as TrialStatus,
    access: { allowed: true, isPremium: false, remaining: 2, reason: 'unlimited' },
    acquire: {
      allowed: true,
      isPremium: false,
      remaining: 2,
      reason: 'unlimited',
      consumedTrial: false,
    },
    pdf: PDF,
    ...overrides,
  };

  const fieldDetection = {
    analyze: jest.fn(async () => cfg.detection),
  } as unknown as FieldDetectionService;

  const visionDetection = {
    analyze: jest.fn(async () => cfg.vision),
  } as unknown as VisionDetectionService;

  const trials = {
    getStatus: jest.fn(async () => cfg.status),
    canUseVisionEngine: jest.fn(async () => cfg.access),
    acquireVisionUse: jest.fn(async () => cfg.acquire),
  } as unknown as VisionTrialService;

  const renderer: PdfPageRenderer = { render: jest.fn(async () => cfg.pages) };

  const saved: Array<{ documentId: string; snapshot: PersistedAnalysis }> = [];
  const store: FieldAnalysisStore = {
    saveAnalysis: jest.fn(async (documentId, snapshot) => {
      saved.push({ documentId, snapshot });
    }),
  };

  const pdfSource: DocumentPdfSource = {
    load: jest.fn(async () => cfg.pdf),
  };

  const service = new FieldAnalysisService(
    fieldDetection,
    visionDetection,
    trials,
    renderer,
    store,
    pdfSource,
  );

  return {
    service,
    fieldDetection,
    visionDetection,
    trials,
    renderer,
    store,
    pdfSource,
    saved,
  };
}

describe('FieldAnalysisService', () => {
  describe('analyze — text PDF (heuristic confident)', () => {
    it('returns and persists heuristic candidates, never renders or calls Vision', async () => {
      const { service, visionDetection, renderer, saved } = makeService({
        detection: heuristicOk(),
      });

      const { fields, status } = await service.analyze(DOC, USER, PDF);

      expect(status.engine).toBe('heuristic');
      expect(status.signal).toBe('ok');
      expect(status.visionStage).toBe('not-needed');
      expect(status.visionError).toBeUndefined();
      expect(fields.map((f) => f.type)).toEqual([SignFieldType.SIGNATURE]);

      expect(renderer.render).not.toHaveBeenCalled();
      expect(visionDetection.analyze).not.toHaveBeenCalled();

      // Heuristic result persisted to the grain-1 store.
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        documentId: DOC,
        snapshot: { engine: 'heuristic', visionStage: 'not-needed' },
      });
      expect(saved[0].snapshot.fields).toHaveLength(1);
    });

    it('fills the trial fields (isPremium / trialsRemaining / upgradeRequired)', async () => {
      const { service } = makeService({
        detection: heuristicOk(),
        status: {
          plan: 'FREE',
          isPremium: false,
          used: 0,
          limit: 2,
          remaining: 2,
          exhausted: false,
        } as TrialStatus,
      });

      const { status } = await service.analyze(DOC, USER, PDF);

      expect(status.isPremium).toBe(false);
      expect(status.trialsRemaining).toBe(2);
      expect(status.upgradeRequired).toBe(false);
      // Base handled it (unlimited) but a trial remains → offer the optional
      // premium accuracy boost. No trial is spent by merely offering it.
      expect(status.boostAvailable).toBe(true);
    });

    it('offers no accuracy boost once trials are gone on a non-premium plan (base stays unlimited, no upsell wall)', async () => {
      const { service } = makeService({
        detection: heuristicOk(),
        status: {
          plan: 'FREE',
          isPremium: false,
          used: 2,
          limit: 2,
          remaining: 0,
          exhausted: true,
        } as TrialStatus,
      });

      const { status } = await service.analyze(DOC, USER, PDF);

      expect(status.visionStage).toBe('not-needed');
      expect(status.upgradeRequired).toBe(false);
      expect(status.boostAvailable).toBe(false);
    });

    it('offers the accuracy boost to a premium account (trials do not apply)', async () => {
      const { service } = makeService({
        detection: heuristicOk(),
        status: {
          plan: 'PRO',
          isPremium: true,
          used: 0,
          limit: 0,
          remaining: 0,
          exhausted: false,
        } as TrialStatus,
      });

      const { status } = await service.analyze(DOC, USER, PDF);

      expect(status.boostAvailable).toBe(true);
    });
  });

  describe('analyze — scanned / low-confidence PDF (no auto Vision)', () => {
    it('records "available" awaiting consent and does NOT run Vision', async () => {
      const { service, visionDetection, renderer, trials, saved } = makeService({
        detection: heuristicNoText(),
        access: { allowed: true, isPremium: false, remaining: 2, reason: 'unlimited' },
      });

      const { fields, status } = await service.analyze(DOC, USER, PDF);

      // Vision must NOT run at upload — consent is spent later.
      expect(renderer.render).not.toHaveBeenCalled();
      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(trials.canUseVisionEngine).toHaveBeenCalledWith(USER);
      expect(trials.acquireVisionUse).not.toHaveBeenCalled();

      expect(status.engine).toBe('heuristic');
      expect(status.visionStage).toBe('available');
      expect(status.isPremium).toBe(false);
      expect(status.trialsRemaining).toBe(2);
      expect(status.upgradeRequired).toBe(false);
      expect(fields).toEqual([]);

      expect(saved[0].snapshot).toMatchObject({
        engine: 'heuristic',
        visionStage: 'available',
      });
    });

    it('also awaits consent on a low-confidence text result', async () => {
      const { service, visionDetection } = makeService({
        detection: heuristicLowConfidence(),
        access: { allowed: true, isPremium: true, remaining: 0, reason: 'premium' },
      });

      const { status } = await service.analyze(DOC, USER, PDF);

      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(status.visionStage).toBe('available');
      expect(status.isPremium).toBe(true);
    });

    it('still resolves to "available" (never blocked) for a FREE account with a zero dormant balance', async () => {
      const { service, saved } = makeService({
        detection: heuristicNoText(),
        // Formerly "exhausted"; premium is now unlimited so access is always allowed.
        access: { allowed: true, isPremium: false, remaining: 0, reason: 'unlimited' },
      });

      const { status } = await service.analyze(DOC, USER, PDF);

      expect(status.visionStage).toBe('available');
      expect(status.upgradeRequired).toBe(false);
      expect(status.trialsRemaining).toBe(0);
      expect(saved[0].snapshot.visionStage).toBe('available');
    });
  });

  describe('runPremiumAnalysis — consent-driven premium run', () => {
    it('runs Vision and persists succeeded for a FREE account without consuming a trial', async () => {
      const { service, trials, visionDetection, renderer, saved } = makeService({
        acquire: {
          allowed: true,
          isPremium: false,
          remaining: 2,
          reason: 'unlimited',
          consumedTrial: false,
        },
      });

      const { fields, status } = await service.runPremiumAnalysis(DOC, USER);

      // Access read through the seam (never consumes), then Vision runs.
      expect(trials.acquireVisionUse).toHaveBeenCalledWith(USER);
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(visionDetection.analyze).toHaveBeenCalledTimes(1);

      expect(status.engine).toBe('vision');
      expect(status.visionStage).toBe('succeeded');
      // Dormant balance is untouched — no trial spent.
      expect(status.trialsRemaining).toBe(2);
      expect(status.upgradeRequired).toBe(false);
      expect(fields).toHaveLength(2);

      expect(saved[0].snapshot).toMatchObject({
        engine: 'vision',
        visionStage: 'succeeded',
      });
      expect(saved[0].snapshot.fields).toHaveLength(2);
    });

    it('does not consume for premium accounts but still runs Vision', async () => {
      const { service, trials } = makeService({
        acquire: {
          allowed: true,
          isPremium: true,
          remaining: 0,
          reason: 'premium',
          consumedTrial: false,
        },
      });

      const { status } = await service.runPremiumAnalysis(DOC, USER);

      expect(trials.acquireVisionUse).toHaveBeenCalledWith(USER);
      expect(status.visionStage).toBe('succeeded');
      expect(status.isPremium).toBe(true);
    });

    it('still runs Vision (never blocks) for a FREE account with a zero dormant balance', async () => {
      const { service, renderer, visionDetection, pdfSource, saved } = makeService({
        // Formerly "exhausted"; premium is unlimited so it runs anyway.
        acquire: {
          allowed: true,
          isPremium: false,
          remaining: 0,
          reason: 'unlimited',
          consumedTrial: false,
        },
      });

      const { fields, status } = await service.runPremiumAnalysis(DOC, USER);

      expect(pdfSource.load).toHaveBeenCalledTimes(1);
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(visionDetection.analyze).toHaveBeenCalledTimes(1);

      expect(status.visionStage).toBe('succeeded');
      expect(status.upgradeRequired).toBe(false);
      expect(status.trialsRemaining).toBe(0);
      expect(fields).toHaveLength(2);
      expect(saved[0].snapshot.visionStage).toBe('succeeded');
    });

    it('persists failed + structured reason when Vision fails', async () => {
      const { service, saved } = makeService({
        vision: { ok: false, error: { reason: 'timeout', detail: '15000ms 초과' } },
      });

      const { fields, status } = await service.runPremiumAnalysis(DOC, USER);

      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('timeout');
      expect(fields).toEqual([]);
      expect(saved[0].snapshot.visionStage).toBe('failed');
    });

    it('treats an unbound renderer (no page images) as an unavailable Vision path', async () => {
      const { service, visionDetection } = makeService({ pages: [] });

      const { status } = await service.runPremiumAnalysis(DOC, USER);

      expect(visionDetection.analyze).not.toHaveBeenCalled();
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('unavailable');
    });

    it('treats an unreadable PDF source as an unavailable Vision path', async () => {
      const { service, renderer } = makeService({ pdf: null });

      const { status } = await service.runPremiumAnalysis(DOC, USER);

      expect(renderer.render).not.toHaveBeenCalled();
      expect(status.visionStage).toBe('failed');
      expect(status.visionError).toBe('unavailable');
    });
  });

  describe('analyzeInBackground', () => {
    it('runs analysis with the user id and swallows loader failures', async () => {
      const { service, fieldDetection } = makeService({ detection: heuristicOk() });
      const analyzeSpy = jest.spyOn(service, 'analyze');

      // Successful background run.
      service.analyzeInBackground(DOC, USER, async () => PDF);
      await flush();
      expect(analyzeSpy).toHaveBeenCalledWith(DOC, USER, PDF);

      // A failing byte loader must not throw out of the fire-and-forget call.
      analyzeSpy.mockClear();
      expect(() =>
        service.analyzeInBackground('doc-2', USER, async () => {
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
