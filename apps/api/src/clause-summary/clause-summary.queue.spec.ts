import { ClauseSummaryQueue } from './clause-summary.queue';
import type { ClauseSummaryService } from './clause-summary.service';

/**
 * These tests pin the fire-and-forget contract of `enqueue()`:
 *   - With no REDIS_URL, generation runs inline via ClauseSummaryService.
 *   - `enqueue()` NEVER throws, even if generation rejects, so a queueing or
 *     summary problem can never break the document send flow.
 */
function makeQueue(overrides: {
  redisUrl?: string;
  generate?: jest.Mock;
} = {}) {
  const generate = overrides.generate ?? jest.fn(async () => undefined);
  const config = {
    get: jest.fn((key: string) => (key === 'REDIS_URL' ? overrides.redisUrl : undefined)),
  };
  const clauseSummary = { generate } as unknown as ClauseSummaryService;
  const queue = new ClauseSummaryQueue(config as never, clauseSummary);
  return { queue, generate, config };
}

describe('ClauseSummaryQueue', () => {
  it('runs generation inline when REDIS_URL is unset', async () => {
    const { queue, generate } = makeQueue();

    await queue.onModuleInit();
    await queue.enqueue('doc_1');

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith('doc_1');
  });

  it('enqueue never throws even if generation rejects', async () => {
    const generate = jest.fn(async () => {
      throw new Error('boom');
    });
    const { queue } = makeQueue({ generate });

    await queue.onModuleInit();
    await expect(queue.enqueue('doc_2')).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledWith('doc_2');
  });

  it('onModuleDestroy is safe when no queue/worker was started', async () => {
    const { queue } = makeQueue();
    await queue.onModuleInit();
    await expect(queue.onModuleDestroy()).resolves.toBeUndefined();
  });
});
