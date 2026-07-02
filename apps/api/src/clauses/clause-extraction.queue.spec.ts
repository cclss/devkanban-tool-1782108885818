import { ClauseExtractionQueue } from './clause-extraction.queue';
import type { ClauseExtractionPipelineService } from './clause-extraction-pipeline.service';

function makeQueue(pipelineOverrides: Partial<ClauseExtractionPipelineService> = {}) {
  const runExtraction = jest.fn(async () => ({
    documentId: 'doc_1',
    processed: true,
    skipped: false,
    status: 'READY' as const,
    cardCount: 1,
  }));
  const pipeline = { runExtraction, ...pipelineOverrides } as unknown as ClauseExtractionPipelineService;
  // No REDIS_URL → the queue stays in inline mode.
  const config = { get: jest.fn(() => undefined) };
  const queue = new ClauseExtractionQueue(config as never, pipeline);
  return { queue, runExtraction, config };
}

describe('ClauseExtractionQueue', () => {
  it('runs the pipeline inline when REDIS_URL is unset', async () => {
    const { queue, runExtraction, config } = makeQueue();
    await queue.onModuleInit();

    await queue.enqueue('doc_1');

    expect(config.get).toHaveBeenCalledWith('REDIS_URL');
    expect(runExtraction).toHaveBeenCalledWith('doc_1');
  });

  it('never throws when the inline pipeline run fails', async () => {
    const runExtraction = jest.fn(async () => {
      throw new Error('extraction blew up');
    });
    const { queue } = makeQueue({ runExtraction } as never);
    await queue.onModuleInit();

    await expect(queue.enqueue('doc_1')).resolves.toBeUndefined();
    expect(runExtraction).toHaveBeenCalledWith('doc_1');
  });
});
