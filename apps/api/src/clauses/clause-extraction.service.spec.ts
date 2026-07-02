import { MESSAGES } from '../common/messages';
import {
  ClauseExtractionService,
  MAX_CLAUSE_CARDS,
} from './clause-extraction.service';
import type {
  ClauseExtractionProvider,
  RawExtractedClause,
} from './clause-extraction.provider';
import { StubClauseProvider } from './stub-clause.provider';
import type { PdfPageText } from './pdf-text.service';

/** A provider whose behavior each test controls. */
function fakeProvider(
  impl: (pages: PdfPageText[], signal: AbortSignal) => Promise<RawExtractedClause[]>,
): ClauseExtractionProvider & { calls: number } {
  return {
    name: 'fake',
    calls: 0,
    async extract(pages, signal) {
      this.calls++;
      return impl(pages, signal);
    },
  };
}

const PAGES: PdfPageText[] = [
  { page: 1, text: '제1조 계약 기간과 자동 갱신에 관한 내용.' },
];

describe('ClauseExtractionService', () => {
  it('maps caution categories to fixed single-source labels and 1-based order', async () => {
    const provider = fakeProvider(async () => [
      {
        title: '자동 갱신',
        summary: '갱신 조항이에요.',
        sourcePage: 2,
        sourceSnippet: '자동으로 갱신된다',
        cautionCategory: 'AUTO_RENEWAL',
      },
      {
        title: '계약 기간',
        summary: '기간 조항이에요.',
        sourcePage: 1,
        cautionCategory: 'NONE',
      },
    ]);
    const service = new ClauseExtractionService(provider);

    const cards = await service.extract(PAGES);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      order: 1,
      title: '자동 갱신',
      summary: '갱신 조항이에요.',
      sourcePage: 2,
      sourceSnippet: '자동으로 갱신된다',
      caution: true,
      cautionReason: MESSAGES.clause.caution.autoRenewal,
    });
    // NONE → no flag, no reason copy.
    expect(cards[1].caution).toBe(false);
    expect(cards[1].cautionReason).toBeUndefined();
    expect(cards[1].order).toBe(2);
  });

  it('caps output at MAX_CLAUSE_CARDS', async () => {
    const many: RawExtractedClause[] = Array.from({ length: 8 }, (_, i) => ({
      title: `조항 ${i}`,
      summary: '요약이에요.',
      sourcePage: 1,
      cautionCategory: 'NONE',
    }));
    const service = new ClauseExtractionService(fakeProvider(async () => many));

    const cards = await service.extract(PAGES);

    expect(cards).toHaveLength(MAX_CLAUSE_CARDS);
    expect(cards.map((c) => c.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns [] for empty / non-text input without calling the provider', async () => {
    const provider = fakeProvider(async () => {
      throw new Error('should not be called');
    });
    const service = new ClauseExtractionService(provider);

    expect(await service.extract([])).toEqual([]);
    expect(await service.extract([{ page: 1, text: '   \n  ' }])).toEqual([]);
    expect(provider.calls).toBe(0);
  });

  it('returns [] when the provider fails (API / parse error absorbed)', async () => {
    const service = new ClauseExtractionService(
      fakeProvider(async () => {
        throw new Error('boom: JSON parse failure');
      }),
    );

    expect(await service.extract(PAGES)).toEqual([]);
  });

  it('returns [] on timeout and aborts the provider signal', async () => {
    let abortedSignal: AbortSignal | undefined;
    const provider = fakeProvider(
      (_pages, signal) =>
        new Promise<RawExtractedClause[]>((_resolve, reject) => {
          abortedSignal = signal;
          // Never resolves on its own; only the timeout's abort ends it.
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const service = new ClauseExtractionService(provider, 20);

    const cards = await service.extract(PAGES);

    expect(cards).toEqual([]);
    expect(abortedSignal?.aborted).toBe(true);
  });

  it('runs the deterministic stub end-to-end (stub path)', async () => {
    const service = new ClauseExtractionService(new StubClauseProvider());
    const pages: PdfPageText[] = [
      { page: 1, text: '제1조 이 계약은 1년간 유효하며 자동 갱신됩니다.' },
      { page: 2, text: '제5조 대금은 매월 말일까지 지급한다. 중도 해지 시 위약금이 발생한다.' },
    ];

    const first = await service.extract(pages);
    const second = await service.extract(pages);

    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.length).toBeLessThanOrEqual(MAX_CLAUSE_CARDS);
    // Deterministic: identical input → identical output.
    expect(second).toEqual(first);
    // Auto-renewal is detected and flagged with the fixed label.
    const renewal = first.find((c) => c.title === MESSAGES.clause.stub.autoRenewal.title);
    expect(renewal?.caution).toBe(true);
    expect(renewal?.cautionReason).toBe(MESSAGES.clause.caution.autoRenewal);
  });
});
