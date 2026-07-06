import { VisionDetectionService } from './vision-detection.service';
import { VisionApiError, type VisionApiClient } from './vision-api-client';
import { SignFieldType } from '@repo/db';
import type {
  RawVisionResponse,
  VisionAnalysisInput,
} from './vision-detection.types';

const INPUT: VisionAnalysisInput = {
  pages: [
    { page: 1, width: 595, height: 842, mimeType: 'image/png', image: Buffer.from('pixels') },
  ],
};

function serviceWith(client: Partial<VisionApiClient>): VisionDetectionService {
  return new VisionDetectionService({
    analyze: async () => ({ fields: [] }),
    ...client,
  } as VisionApiClient);
}

describe('VisionDetectionService', () => {
  it('normalizes a successful response into the shared vision result', async () => {
    const raw: RawVisionResponse = {
      fields: [
        { type: 'signature', page: 1, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, confidence: 0.9, label: '서명' },
      ],
    };
    const service = serviceWith({ analyze: async () => raw });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.result.engine).toBe('vision');
    expect(outcome.result.signal).toBe('ok');
    expect(outcome.result.fields[0].type).toBe(SignFieldType.SIGNATURE);
  });

  it('returns a safe `timeout` error (does not throw) on a client timeout', async () => {
    const service = serviceWith({
      analyze: async () => {
        throw new VisionApiError('timeout', '5ms 초과');
      },
    });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('timeout');
  });

  it('returns a safe `api-error` (with status) on an HTTP failure', async () => {
    const service = serviceWith({
      analyze: async () => {
        throw new VisionApiError('api-error', 'HTTP 502', 502);
      },
    });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('api-error');
    expect(outcome.error.status).toBe(502);
  });

  it('returns a safe `unavailable` error when the engine is not configured', async () => {
    const service = serviceWith({
      analyze: async () => {
        throw new VisionApiError('unavailable', 'VISION_API_ENDPOINT/KEY 미설정');
      },
    });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('unavailable');
  });

  it('maps a contract-violating 2xx body to a safe `bad-response`', async () => {
    const service = serviceWith({
      analyze: async () => ({}) as RawVisionResponse, // no fields[] array
    });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('bad-response');
  });

  it('maps an unexpected (non-VisionApiError) throw to a safe `api-error`', async () => {
    const service = serviceWith({
      analyze: async () => {
        throw new Error('boom');
      },
    });

    const outcome = await service.analyze(INPUT);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('api-error');
  });
});
