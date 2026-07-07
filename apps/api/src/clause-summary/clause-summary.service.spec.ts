import { Prisma } from '@repo/db';
import type { ClauseSummary } from '@repo/db';
import { ClauseSummaryService } from './clause-summary.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { PdfTextService } from './pdf-text.service';
import type { ClauseSummaryLlm } from './clause-summary.llm';

/** A valid ClauseSummary fixture matching the shared contract. */
const SUMMARY: ClauseSummary = {
  oneLiner: '월 300만 원에 6개월간 디자인 용역을 맡기는 계약이에요.',
  clauses: [
    {
      headline: '위약금은 계약금의 10%예요',
      detail: '계약을 중도 해지하면 계약금의 10%를 위약금으로 물어야 해요.',
      category: '해지',
      emphasis: 'caution',
      sourcePage: 2,
    },
    {
      headline: '대금은 매월 말일에 지급돼요',
      detail: '매월 마지막 날에 300만 원이 지급돼요.',
      category: '대금',
      emphasis: 'normal',
    },
  ],
};

interface Harness {
  service: ClauseSummaryService;
  findUnique: jest.Mock;
  updateMany: jest.Mock;
  read: jest.Mock;
  extract: jest.Mock;
  summarize: jest.Mock;
  isConfigured: boolean;
}

function makeHarness(
  opts: {
    document?: Record<string, unknown> | null;
    pages?: string[];
    summary?: ClauseSummary | null;
    isConfigured?: boolean;
    updateCount?: number;
  } = {},
): Harness {
  const {
    document = { id: 'doc_1', storageKey: 'documents/u/orig.pdf', clauseSummary: null },
    pages = ['제1조 대금. 월 300만 원.', '제2조 해지. 위약금 10%.'],
    summary = SUMMARY,
    isConfigured = true,
    updateCount = 1,
  } = opts;

  const findUnique = jest.fn().mockResolvedValue(document);
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
  const read = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  const extract = jest.fn().mockResolvedValue({ pages, pageCount: pages.length });
  const summarize = jest.fn().mockResolvedValue(summary);

  const prisma = { document: { findUnique, updateMany } } as unknown as PrismaService;
  const storage = { read } as unknown as StorageService;
  const pdfText = { extract } as unknown as PdfTextService;
  const llm = { isConfigured, summarize } as unknown as ClauseSummaryLlm;

  return {
    service: new ClauseSummaryService(prisma, storage, pdfText, llm),
    findUnique,
    updateMany,
    read,
    extract,
    summarize,
    isConfigured,
  };
}

describe('ClauseSummaryService.generate', () => {
  it('happy path: reads PDF, summarizes, and stores idempotently', async () => {
    const h = makeHarness();
    await expect(h.service.generate('doc_1')).resolves.toBeUndefined();

    expect(h.read).toHaveBeenCalledWith('documents/u/orig.pdf');
    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(h.summarize).toHaveBeenCalledTimes(1);
    expect(h.updateMany).toHaveBeenCalledTimes(1);

    const call = h.updateMany.mock.calls[0][0];
    // null-guarded write so a concurrent/duplicate run can't overwrite.
    expect(call.where).toEqual({ id: 'doc_1', clauseSummary: { equals: Prisma.DbNull } });
    expect(call.data.clauseSummary).toEqual(SUMMARY);
  });

  it('no-op when the LLM is not configured (no PDF read, no write)', async () => {
    const h = makeHarness({ isConfigured: false });
    await h.service.generate('doc_1');

    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.summarize).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('skips work when a summary already exists', async () => {
    const h = makeHarness({
      document: { id: 'doc_1', storageKey: 'k', clauseSummary: SUMMARY },
    });
    await h.service.generate('doc_1');

    expect(h.read).not.toHaveBeenCalled();
    expect(h.summarize).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('no-op when the document is not found', async () => {
    const h = makeHarness({ document: null });
    await expect(h.service.generate('missing')).resolves.toBeUndefined();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('no-op (no LLM call) for a scanned/image PDF with no extractable text', async () => {
    const h = makeHarness({ pages: ['', '   ', ''] });
    await h.service.generate('doc_1');

    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.summarize).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('does not write when the LLM returns no summary', async () => {
    const h = makeHarness({ summary: null });
    await h.service.generate('doc_1');

    expect(h.summarize).toHaveBeenCalledTimes(1);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('never throws when the PDF read fails (does not block sending)', async () => {
    const h = makeHarness();
    h.read.mockRejectedValueOnce(new Error('storage down'));
    await expect(h.service.generate('doc_1')).resolves.toBeUndefined();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it('never throws when the LLM call fails', async () => {
    const h = makeHarness();
    h.summarize.mockRejectedValueOnce(new Error('llm 5xx'));
    await expect(h.service.generate('doc_1')).resolves.toBeUndefined();
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
