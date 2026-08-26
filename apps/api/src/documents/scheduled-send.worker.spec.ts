import { ScheduledSendWorker } from './scheduled-send.worker';

const worker = {
  on: jest.fn(),
  close: jest.fn(async () => undefined),
};
const Worker = jest.fn(() => worker);

jest.mock('bullmq', () => ({ Worker }));

describe('ScheduledSendWorker', () => {
  const data = {
    documentId: 'doc-1',
    ownerId: 'owner-1',
    jobId: 'job-1',
    recipients: [],
  };

  let config: { get: jest.Mock };
  let documents: { dispatchScheduled: jest.Mock; notifyScheduledDispatchFailed: jest.Mock };
  let service: ScheduledSendWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    config = { get: jest.fn(() => 'redis://localhost:6379') };
    documents = {
      dispatchScheduled: jest.fn(async () => undefined),
      notifyScheduledDispatchFailed: jest.fn(async () => undefined),
    };
    service = new ScheduledSendWorker(config as never, documents as never);
  });

  it('passes a due delayed job to the scheduled dispatch service', async () => {
    await service.onModuleInit();

    const processor = (
      Worker as unknown as {
        mock: { calls: Array<[unknown, (job: { data: typeof data }) => Promise<void>]> };
      }
    ).mock.calls[0][1];
    await processor({ data });

    expect(documents.dispatchScheduled).toHaveBeenCalledWith(data);
  });

  it('notifies the sender only when a job has exhausted its retry attempts', async () => {
    await service.onModuleInit();

    const failed = worker.on.mock.calls.find(([event]) => event === 'failed')?.[1] as (
      job: { data: typeof data; opts: { attempts: number }; attemptsMade: number },
      error: Error,
    ) => void;

    failed({ data, opts: { attempts: 3 }, attemptsMade: 1 }, new Error('temporary failure'));
    failed({ data, opts: { attempts: 3 }, attemptsMade: 3 }, new Error('final failure'));
    await Promise.resolve();

    expect(documents.notifyScheduledDispatchFailed).toHaveBeenCalledTimes(1);
    expect(documents.notifyScheduledDispatchFailed).toHaveBeenCalledWith(data);
  });
});
