import { ScheduledSendQueue } from './scheduled-send.queue';
import {
  SCHEDULED_SEND_JOB,
  type ScheduledSendDispatcher,
  type ScheduledSendJobData,
} from './scheduled-send.constants';

/** A fired job's payload fixture. */
function jobData(overrides: Partial<ScheduledSendJobData> = {}): ScheduledSendJobData {
  return {
    documentId: 'doc-1',
    ownerId: 'owner-1',
    recipients: [{ email: 'a@ex.com', name: '갑', order: 0, index: 0 }],
    ip: '203.0.113.7',
    ...overrides,
  };
}

/**
 * Build a queue whose dispatcher (resolved lazily via ModuleRef) is a mock, so
 * we can assert the worker hands fired jobs to `dispatchScheduled` and routes
 * exhausted failures to `notifyScheduledSendFailure`.
 */
function makeQueue(): {
  queue: ScheduledSendQueue;
  dispatcher: jest.Mocked<ScheduledSendDispatcher>;
} {
  const dispatcher: jest.Mocked<ScheduledSendDispatcher> = {
    dispatchScheduled: jest.fn(async (_data: ScheduledSendJobData): Promise<void> => {}),
    notifyScheduledSendFailure: jest.fn(
      async (_documentId: string, _reason: string): Promise<void> => {},
    ),
  };
  const moduleRef = { get: jest.fn(() => dispatcher) };
  const config = { get: jest.fn(() => undefined) };
  const queue = new ScheduledSendQueue(config as never, moduleRef as never);
  return { queue, dispatcher };
}

/** Reach into a private field/method for white-box wiring assertions. */
function priv(queue: ScheduledSendQueue): {
  queue: unknown;
  timers: Map<string, NodeJS.Timeout>;
  runDispatch(data: ScheduledSendJobData): Promise<void>;
  runInline(data: ScheduledSendJobData): Promise<void>;
  handleFinalFailure(job: unknown, err: Error): Promise<void>;
} {
  return queue as unknown as ReturnType<typeof priv>;
}

describe('ScheduledSendQueue — BullMQ producer', () => {
  it('schedule() adds a delayed job and returns its id', async () => {
    const { queue } = makeQueue();
    const add = jest.fn(async () => ({ id: 'job_abc' }));
    priv(queue).queue = { add } as never;

    const jobId = await queue.schedule('doc-1', 60_000, {
      ownerId: 'owner-1',
      recipients: jobData().recipients,
      ip: '203.0.113.7',
    });

    expect(jobId).toBe('job_abc');
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] as unknown as [
      string,
      ScheduledSendJobData,
      { delay: number },
    ];
    expect(name).toBe(SCHEDULED_SEND_JOB);
    expect(data).toMatchObject({ documentId: 'doc-1', ownerId: 'owner-1' });
    expect(opts.delay).toBe(60_000);
  });

  it('schedule() clamps a negative/fractional delay to a non-negative integer', async () => {
    const { queue } = makeQueue();
    const add = jest.fn(async () => ({ id: 'job_x' }));
    priv(queue).queue = { add } as never;

    await queue.schedule('doc-1', -5000.7, { ownerId: 'o', recipients: [] });

    const [, , opts] = add.mock.calls[0] as unknown as [string, unknown, { delay: number }];
    expect(opts.delay).toBe(0);
  });

  it('remove() looks the job up by id and removes it', async () => {
    const { queue } = makeQueue();
    const remove = jest.fn(async () => undefined);
    const getJob = jest.fn(async () => ({ remove }));
    priv(queue).queue = { getJob } as never;

    await queue.remove('job_abc');

    expect(getJob).toHaveBeenCalledWith('job_abc');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('remove() is a no-op when the job is already gone', async () => {
    const { queue } = makeQueue();
    const getJob = jest.fn(async () => null);
    priv(queue).queue = { getJob } as never;

    await expect(queue.remove('missing')).resolves.toBeUndefined();
    expect(getJob).toHaveBeenCalledWith('missing');
  });
});

describe('ScheduledSendQueue — worker fire', () => {
  it('hands a fired job to dispatchScheduled (auto-send)', async () => {
    const { queue, dispatcher } = makeQueue();
    const data = jobData();

    await priv(queue).runDispatch(data);

    expect(dispatcher.dispatchScheduled).toHaveBeenCalledWith(data);
  });

  it('alerts the sender only once the retry budget is exhausted', async () => {
    const { queue, dispatcher } = makeQueue();
    const err = new Error('boom');

    // Still retrying → no alert yet.
    await priv(queue).handleFinalFailure(
      { data: jobData(), attemptsMade: 1, opts: { attempts: 3 } },
      err,
    );
    expect(dispatcher.notifyScheduledSendFailure).not.toHaveBeenCalled();

    // Final attempt failed → alert the sender.
    await priv(queue).handleFinalFailure(
      { data: jobData(), attemptsMade: 3, opts: { attempts: 3 } },
      err,
    );
    expect(dispatcher.notifyScheduledSendFailure).toHaveBeenCalledWith('doc-1', 'Error: boom');
  });
});

describe('ScheduledSendQueue — in-memory fallback (no REDIS_URL)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schedule() registers a timer that dispatches on fire', async () => {
    const { queue, dispatcher } = makeQueue();

    const jobId = await queue.schedule('doc-1', 1000, {
      ownerId: 'owner-1',
      recipients: jobData().recipients,
    });

    expect(jobId).toMatch(/^local-/);
    expect(priv(queue).timers.has(jobId)).toBe(true);

    jest.advanceTimersByTime(1000);
    await Promise.resolve(); // let the timer's async callback settle

    expect(dispatcher.dispatchScheduled).toHaveBeenCalledTimes(1);
    expect(priv(queue).timers.has(jobId)).toBe(false);
  });

  it('remove() cancels a pending fallback timer before it fires', async () => {
    const { queue, dispatcher } = makeQueue();

    const jobId = await queue.schedule('doc-1', 1000, { ownerId: 'o', recipients: [] });
    await queue.remove(jobId);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(dispatcher.dispatchScheduled).not.toHaveBeenCalled();
    expect(priv(queue).timers.has(jobId)).toBe(false);
  });

  it('a failing inline dispatch alerts the sender', async () => {
    const { queue, dispatcher } = makeQueue();
    dispatcher.dispatchScheduled.mockRejectedValueOnce(new Error('nope'));

    await priv(queue).runInline(jobData());

    expect(dispatcher.notifyScheduledSendFailure).toHaveBeenCalledWith('doc-1', 'Error: nope');
  });
});
