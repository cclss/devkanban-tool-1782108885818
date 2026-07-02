import { ConfigService } from '@nestjs/config';
import {
  AiFieldAnalyzerService,
  type FieldCandidate,
} from './ai-field-analyzer.service';
import type { ExtractedDocument } from './document-extraction.service';
import type { NormRect } from '../pdf/field-geometry';

/** A ConfigService stub that only knows about ANTHROPIC_API_KEY. */
function configWith(apiKey?: string): ConfigService {
  return {
    get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? apiKey : undefined),
  } as unknown as ConfigService;
}

function span(text: string, bbox: Partial<NormRect> = {}): {
  text: string;
  bbox: NormRect;
} {
  return {
    text,
    bbox: { x: 0.1, y: 0.5, width: 0.15, height: 0.02, ...bbox },
  };
}

/** A small document exercising each heuristic rule. */
function sampleDoc(): ExtractedDocument {
  return {
    pages: [
      {
        index: 0,
        pageSize: { width: 600, height: 800 },
        textSpans: [
          span('서명:', { x: 0.1, y: 0.8 }),
          span('계약 날짜', { x: 0.1, y: 0.6 }),
          span('이름 ________', { x: 0.1, y: 0.4 }),
          span('본문 문단입니다', { x: 0.1, y: 0.2 }),
        ],
      },
      {
        index: 1,
        pageSize: { width: 600, height: 800 },
        textSpans: [span('Signature', { x: 0.2, y: 0.5 })],
      },
    ],
  };
}

function inRange01(bbox: NormRect): boolean {
  return [bbox.x, bbox.y, bbox.width, bbox.height].every((v) => v >= 0 && v <= 1);
}

describe('AiFieldAnalyzerService — heuristic stub', () => {
  const service = new AiFieldAnalyzerService(configWith(undefined));

  it('reports the AI path as disabled when no key is set', () => {
    expect(service.isAiEnabled).toBe(false);
  });

  it('returns the heuristic source when the AI path is disabled', async () => {
    const result = await service.analyze(sampleDoc());
    expect(result.source).toBe('heuristic');
  });

  it('maps label keywords and blank runs to field candidates', async () => {
    const { fields } = await service.analyze(sampleDoc());

    const byType = (t: FieldCandidate['type']) => fields.filter((f) => f.type === t);
    // 서명: (p0) + Signature (p1)
    expect(byType('SIGNATURE')).toHaveLength(2);
    // 계약 날짜 (p0)
    expect(byType('DATE')).toHaveLength(1);
    // 이름 ________ (p0)
    expect(byType('TEXT')).toHaveLength(1);

    // The plain paragraph produces no candidate.
    expect(fields.some((f) => f.label === '본문 문단입니다')).toBe(false);

    // Page indices are carried through.
    expect(byType('SIGNATURE').map((f) => f.page).sort()).toEqual([0, 1]);
  });

  it('is case-insensitive for English keywords', async () => {
    const doc: ExtractedDocument = {
      pages: [
        {
          index: 0,
          pageSize: { width: 100, height: 100 },
          textSpans: [span('Please put the DATE here', { x: 0.1, y: 0.5 })],
        },
      ],
    };
    const { fields } = await service.analyze(doc);
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('DATE');
  });

  it('places a signature field to the right of its label, on the same row', async () => {
    const { fields } = await service.analyze(sampleDoc());
    const sig = fields.find((f) => f.type === 'SIGNATURE' && f.page === 0)!;
    // label at x=0.1, width=0.15 → field starts to the right of 0.25.
    expect(sig.bbox.x).toBeGreaterThan(0.25);
    // Same baseline row as the label.
    expect(sig.bbox.y).toBeCloseTo(0.8, 5);
  });

  it('keeps every candidate box within the 0..1 normalized range', async () => {
    const { fields } = await service.analyze(sampleDoc());
    for (const f of fields) expect(inRange01(f.bbox)).toBe(true);
  });

  it('falls back to the span box when a label sits at the right edge', async () => {
    const doc: ExtractedDocument = {
      pages: [
        {
          index: 0,
          pageSize: { width: 100, height: 100 },
          textSpans: [span('서명', { x: 0.97, y: 0.5, width: 0.02 })],
        },
      ],
    };
    const { fields } = await service.analyze(doc);
    expect(fields).toHaveLength(1);
    expect(inRange01(fields[0].bbox)).toBe(true);
  });

  it('is deterministic — identical input yields identical output', async () => {
    const a = await service.analyze(sampleDoc());
    const b = await service.analyze(sampleDoc());
    expect(a).toEqual(b);
  });

  it('returns an empty list for a document with no matchable spans', async () => {
    const doc: ExtractedDocument = {
      pages: [
        {
          index: 0,
          pageSize: { width: 100, height: 100 },
          textSpans: [span('just some prose', { x: 0.1, y: 0.5 })],
        },
      ],
    };
    const { fields } = await service.analyze(doc);
    expect(fields).toEqual([]);
  });
});

describe('AiFieldAnalyzerService — AI path + fallback', () => {
  /** Subclass exposing a seam over the provider call, without any network. */
  class StubbedAnalyzer extends AiFieldAnalyzerService {
    constructor(
      apiKey: string | undefined,
      private readonly impl: () => Promise<FieldCandidate[]>,
    ) {
      super(configWith(apiKey));
    }
    protected override analyzeWithAi(): Promise<FieldCandidate[]> {
      return this.impl();
    }
  }

  it("uses the AI path and reports source 'ai' when the provider succeeds", async () => {
    const aiFields: FieldCandidate[] = [
      { type: 'SIGNATURE', page: 0, bbox: { x: 0.5, y: 0.5, width: 0.2, height: 0.05 }, confidence: 0.9 },
    ];
    const service = new StubbedAnalyzer('test-key', async () => aiFields);

    const result = await service.analyze(sampleDoc());
    expect(result.source).toBe('ai');
    expect(result.fields).toEqual(aiFields);
  });

  it('falls back to the heuristic (never throws) when the provider fails', async () => {
    const service = new StubbedAnalyzer('test-key', async () => {
      throw new Error('provider down');
    });

    const result = await service.analyze(sampleDoc());
    expect(result.source).toBe('heuristic');
    // The deterministic stub still produced candidates.
    expect(result.fields.length).toBeGreaterThan(0);
  });

  it('does not attempt the AI path when no key is configured', async () => {
    const impl = jest.fn(async () => [] as FieldCandidate[]);
    const service = new StubbedAnalyzer(undefined, impl);

    const result = await service.analyze(sampleDoc());
    expect(impl).not.toHaveBeenCalled();
    expect(result.source).toBe('heuristic');
  });
});
