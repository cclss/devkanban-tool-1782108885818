import { ClauseExtractionPipelineService } from './clause-extraction-pipeline.service';
import type { ExtractedClause } from './clause-extraction.service';
import type { PdfTextExtraction } from './pdf-text.service';

/** One READY clause card fixture. */
function card(order: number, overrides: Partial<ExtractedClause> = {}): ExtractedClause {
  return {
    order,
    title: `조항 ${order}`,
    summary: `요약 ${order}`,
    sourcePage: order,
    sourceSnippet: `발췌 ${order}`,
    caution: false,
    ...overrides,
  };
}

interface Harness {
  service: ClauseExtractionPipelineService;
  storageRead: jest.Mock;
  pdfExtract: jest.Mock;
  clauseExtract: jest.Mock;
  deleteMany: jest.Mock;
  createMany: jest.Mock;
  update: jest.Mock;
  txCalls: unknown[][];
}

function makeHarness(opts: {
  document?: { id: string; storageKey: string } | null;
  pages?: PdfTextExtraction;
  cards?: ExtractedClause[];
  readError?: Error;
  updateError?: Error;
} = {}): Harness {
  const document =
    opts.document === undefined
      ? { id: 'doc_1', storageKey: 'documents/user_1/original.pdf' }
      : opts.document;

  const pages: PdfTextExtraction =
    opts.pages ?? {
      status: 'TEXT',
      pages: [{ page: 1, text: '계약 본문' }],
      totalChars: 100,
    };

  const storageRead = jest.fn(async () => {
    if (opts.readError) throw opts.readError;
    return Buffer.from('%PDF-1.4');
  });
  const pdfExtract = jest.fn(async () => pages);
  const clauseExtract = jest.fn(async () => opts.cards ?? []);

  const deleteMany = jest.fn((args: unknown) => ({ op: 'deleteMany', args }));
  const createMany = jest.fn((args: unknown) => ({ op: 'createMany', args }));
  const update = jest.fn(async (args: unknown) => {
    if (opts.updateError) throw opts.updateError;
    return { op: 'update', args };
  });

  const txCalls: unknown[][] = [];
  const prisma = {
    document: {
      findUnique: jest.fn(async () => document),
      update,
    },
    contractClause: { deleteMany, createMany },
    // Array-form transaction: resolve every queued operation together.
    $transaction: jest.fn(async (ops: unknown[]) => {
      txCalls.push(ops);
      return Promise.all(ops.map((op) => Promise.resolve(op)));
    }),
  };

  const storage = { read: storageRead };
  const pdfText = { extract: pdfExtract };
  const clauses = { extract: clauseExtract };

  const service = new ClauseExtractionPipelineService(
    prisma as never,
    storage as never,
    pdfText as never,
    clauses as never,
  );

  return { service, storageRead, pdfExtract, clauseExtract, deleteMany, createMany, update, txCalls };
}

describe('ClauseExtractionPipelineService.runExtraction', () => {
  it('records READY and persists cards when extraction yields cards', async () => {
    const h = makeHarness({ cards: [card(1), card(2, { caution: true, cautionReason: '주의' })] });

    const result = await h.service.runExtraction('doc_1');

    expect(result).toMatchObject({ processed: true, skipped: false, status: 'READY', cardCount: 2 });
    // Replace-then-insert inside one transaction (idempotent).
    expect(h.txCalls).toHaveLength(1);
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc_1' } });
    expect(h.createMany).toHaveBeenCalledTimes(1);
    const createArgs = h.createMany.mock.calls[0][0] as { data: unknown[] };
    expect(createArgs.data).toHaveLength(2);
    expect(createArgs.data[1]).toMatchObject({
      documentId: 'doc_1',
      order: 2,
      caution: true,
      cautionReason: '주의',
    });
    // Status recorded READY with a timestamp.
    const updateArgs = h.update.mock.calls[0][0] as { data: { clauseStatus: string; clauseExtractedAt: Date } };
    expect(updateArgs.data.clauseStatus).toBe('READY');
    expect(updateArgs.data.clauseExtractedAt).toBeInstanceOf(Date);
  });

  it('records EMPTY (no createMany) when extraction yields zero cards', async () => {
    const h = makeHarness({ cards: [] });

    const result = await h.service.runExtraction('doc_1');

    expect(result).toMatchObject({ processed: true, status: 'EMPTY', cardCount: 0 });
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc_1' } });
    expect(h.createMany).not.toHaveBeenCalled();
    expect(h.update.mock.calls[0][0].data.clauseStatus).toBe('EMPTY');
  });

  it('records EMPTY for a non-text document (empty pages → no cards)', async () => {
    const h = makeHarness({
      pages: { status: 'EMPTY', reason: 'NON_TEXT', pages: [], totalChars: 0 },
      cards: [],
    });

    const result = await h.service.runExtraction('doc_1');

    expect(result.status).toBe('EMPTY');
    expect(h.clauseExtract).toHaveBeenCalledWith([]);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it('records FAILED without deleting cards when reading the PDF throws', async () => {
    const h = makeHarness({ readError: new Error('object not found') });

    const result = await h.service.runExtraction('doc_1');

    expect(result).toMatchObject({ processed: true, status: 'FAILED', cardCount: 0 });
    // Never runs the replace transaction — existing cards are preserved.
    expect(h.txCalls).toHaveLength(0);
    expect(h.deleteMany).not.toHaveBeenCalled();
    expect(h.createMany).not.toHaveBeenCalled();
    // Best-effort status write.
    expect(h.update.mock.calls[0][0].data.clauseStatus).toBe('FAILED');
  });

  it('never throws even if recording FAILED also fails', async () => {
    const h = makeHarness({
      readError: new Error('boom'),
      updateError: new Error('db down'),
    });

    await expect(h.service.runExtraction('doc_1')).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('skips a missing document without any writes', async () => {
    const h = makeHarness({ document: null });

    const result = await h.service.runExtraction('nope');

    expect(result).toMatchObject({ processed: false, skipped: true });
    expect(h.storageRead).not.toHaveBeenCalled();
    expect(h.txCalls).toHaveLength(0);
    expect(h.update).not.toHaveBeenCalled();
  });
});
