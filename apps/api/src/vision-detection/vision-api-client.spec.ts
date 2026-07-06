import { ConfigService } from '@nestjs/config';
import {
  HttpVisionApiClient,
  VisionApiError,
  type VisionFetch,
  type VisionHttpResponse,
} from './vision-api-client';
import type { VisionAnalysisInput } from './vision-detection.types';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function okResponse(json: unknown): VisionHttpResponse {
  return { ok: true, status: 200, json: async () => json };
}

const INPUT: VisionAnalysisInput = {
  pages: [
    { page: 1, width: 595, height: 842, mimeType: 'image/png', image: Buffer.from('pixels') },
  ],
};

const CONFIGURED = {
  VISION_API_ENDPOINT: 'https://vision.example/api/analyze',
  VISION_API_KEY: 'secret-key',
};

describe('HttpVisionApiClient', () => {
  it('throws `unavailable` (no outbound call) when endpoint/key are unset', async () => {
    let called = false;
    const fetchImpl: VisionFetch = async () => {
      called = true;
      return okResponse({ fields: [] });
    };
    const client = new HttpVisionApiClient(configWith({}), fetchImpl);

    await expect(client.analyze(INPUT)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(called).toBe(false);
  });

  it('POSTs only page images + geometry, with the API key in the Authorization header', async () => {
    let capturedBody = '';
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl: VisionFetch = async (_url, init) => {
      capturedBody = init.body;
      capturedHeaders = init.headers;
      return okResponse({ fields: [] });
    };
    const client = new HttpVisionApiClient(configWith(CONFIGURED), fetchImpl);

    await client.analyze({
      pages: [
        {
          // Extra identifying props must not reach the wire.
          ...INPUT.pages[0],
          ownerEmail: 'user@example.com',
          sourceFilename: 'secret.pdf',
        } as VisionAnalysisInput['pages'][number],
      ],
    });

    expect(capturedHeaders.authorization).toBe('Bearer secret-key');
    const parsed = JSON.parse(capturedBody);
    expect(Object.keys(parsed)).toEqual(['pages']);
    expect(Object.keys(parsed.pages[0]).sort()).toEqual([
      'height',
      'image',
      'mimeType',
      'page',
      'width',
    ]);
    expect(capturedBody).not.toContain('user@example.com');
    expect(capturedBody).not.toContain('secret.pdf');
  });

  it('returns the parsed body on a 2xx response', async () => {
    const payload = { fields: [{ type: 'signature', page: 1, box: { x: 0, y: 0, width: 0.2, height: 0.1 }, confidence: 0.9 }] };
    const client = new HttpVisionApiClient(configWith(CONFIGURED), async () => okResponse(payload));

    await expect(client.analyze(INPUT)).resolves.toEqual(payload);
  });

  it('maps a non-2xx response to `api-error` carrying the status', async () => {
    const client = new HttpVisionApiClient(configWith(CONFIGURED), async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));

    await expect(client.analyze(INPUT)).rejects.toMatchObject({
      reason: 'api-error',
      status: 502,
    });
  });

  it('maps a transport failure to `api-error`', async () => {
    const client = new HttpVisionApiClient(configWith(CONFIGURED), async () => {
      throw new Error('ECONNRESET');
    });

    const err = await client.analyze(INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(VisionApiError);
    expect(err.reason).toBe('api-error');
  });

  it('maps an unparseable body to `bad-response`', async () => {
    const client = new HttpVisionApiClient(configWith(CONFIGURED), async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));

    await expect(client.analyze(INPUT)).rejects.toMatchObject({
      reason: 'bad-response',
    });
  });

  it('aborts and maps to `timeout` when the request exceeds the deadline', async () => {
    // Fetch that never resolves on its own but honours the abort signal.
    const hangingFetch: VisionFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const client = new HttpVisionApiClient(
      configWith({ ...CONFIGURED, VISION_API_TIMEOUT_MS: '5' }),
      hangingFetch,
    );

    await expect(client.analyze(INPUT)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });
});
