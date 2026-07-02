import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentFormat, DocumentStatus } from '@repo/db';
import { DocumentsService } from './documents.service';
import type { ExtractedDocument } from './document-extraction.service';
import type { FieldAnalysisResult, FieldCandidate } from './ai-field-analyzer.service';
import { MESSAGES } from '../common/messages';

/**
 * analyze() orchestration: owner/state guards, the extract → analyze →
 * normalize pipeline, graceful degradation to an empty reasoned result, and the
 * DOCUMENT_ANALYZED audit trail. The extraction and analyzer collaborators are
 * stubbed — their own behavior is covered in their dedicated specs.
 */
describe('DocumentsService.analyze', () => {
  const OWNER = 'owner-1';
  const DOC_ID = 'doc-1';

  function draftDoc(overrides: Record<string, unknown> = {}) {
    return {
      id: DOC_ID,
      ownerId: OWNER,
      status: DocumentStatus.DRAFT,
      storageKey: 'key/doc.pdf',
      format: DocumentFormat.PDF,
      ...overrides,
    };
  }

  function extractedWithPages(pageCount: number): ExtractedDocument {
    return {
      pages: Array.from({ length: pageCount }, (_, i) => ({
        index: i,
        pageSize: { width: 600, height: 800 },
        textSpans: [],
      })),
    };
  }

  /** Build a service with stubbed collaborators; returns the audit-capture spy. */
  function makeService(opts: {
    document?: Record<string, unknown> | null;
    read?: () => Promise<Buffer>;
    extract?: () => Promise<ExtractedDocument>;
    analyze?: () => Promise<FieldAnalysisResult>;
  }) {
    const auditCreate = jest.fn().mockResolvedValue(undefined);
    const document = 'document' in opts ? opts.document : draftDoc();
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue(document) },
      auditLog: { create: auditCreate },
    };
    const storage = { read: opts.read ?? (async () => Buffer.from('bytes')) };
    const extraction = {
      extract: opts.extract ?? (async () => extractedWithPages(1)),
    };
    const analyzer = {
      analyze:
        opts.analyze ?? (async (): Promise<FieldAnalysisResult> => ({ source: 'heuristic', fields: [] })),
    };
    const docxToPdf = { convert: async () => Buffer.from('%PDF-converted') };
    const service = new DocumentsService(
      prisma as never,
      storage as never,
      {} as never,
      {} as never,
      extraction as never,
      analyzer as never,
      docxToPdf as never,
    );
    return { service, auditCreate, prisma };
  }

  it('normalizes candidates into 1-based, clamped, editor-ready fields', async () => {
    const candidates: FieldCandidate[] = [
      { type: 'SIGNATURE', page: 0, bbox: { x: 0.1, y: 0.8, width: 0.2, height: 0.05 }, confidence: 0.9, label: '서명' },
      { type: 'DATE', page: 0, bbox: { x: 0.9, y: 0.5, width: 0.4, height: 0.05 }, confidence: 0.7 },
    ];
    const { service } = makeService({
      extract: async () => extractedWithPages(2),
      analyze: async () => ({ source: 'ai', fields: candidates }),
    });

    const result = await service.analyze(OWNER, DOC_ID, '1.2.3.4');

    expect(result.meta.source).toBe('ai');
    expect(result.meta.fieldCount).toBe(2);
    expect(result.meta.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.meta.reason).toBeUndefined();

    // 0-based candidate page → 1-based field page; recipientIndex defaults to 0.
    expect(result.fields[0]).toEqual({
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.8,
      width: 0.2,
      height: 0.05,
      recipientIndex: 0,
    });
    // The DATE box overflowed the right edge (0.9 + 0.4) → width clamped to 0.1.
    expect(result.fields[1].width).toBeCloseTo(0.1, 6);
    // No label / confidence leak into the editor contract.
    expect(result.fields[0]).not.toHaveProperty('label');
    expect(result.fields[0]).not.toHaveProperty('confidence');
  });

  it('drops candidates on out-of-range pages and degenerate boxes', async () => {
    const candidates: FieldCandidate[] = [
      { type: 'TEXT', page: 5, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, confidence: 0.5 }, // page ≥ count
      { type: 'TEXT', page: 0, bbox: { x: 1, y: 0.1, width: 0.2, height: 0.05 }, confidence: 0.5 }, // no room → dropped
      { type: 'TEXT', page: 0, bbox: { x: 0.2, y: 0.2, width: 0.3, height: 0.1 }, confidence: 0.5 }, // kept
    ];
    const { service } = makeService({
      extract: async () => extractedWithPages(1),
      analyze: async () => ({ source: 'ai', fields: candidates }),
    });

    const result = await service.analyze(OWNER, DOC_ID);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].page).toBe(1);
  });

  it('returns 200 with an empty list + reason when analysis finds nothing', async () => {
    const { service, auditCreate } = makeService({
      analyze: async () => ({ source: 'heuristic', fields: [] }),
    });

    const result = await service.analyze(OWNER, DOC_ID);
    expect(result.fields).toEqual([]);
    expect(result.meta.source).toBe('heuristic');
    expect(result.meta.fieldCount).toBe(0);
    expect(result.meta.reason).toBe(MESSAGES.analyze.empty);
    // The audit trail is still written for an empty (but successful) analysis.
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty reasoned result (never throws) when extraction fails', async () => {
    const { service, auditCreate } = makeService({
      extract: async () => {
        throw new BadRequestException(MESSAGES.document.corruptPdf);
      },
    });

    const result = await service.analyze(OWNER, DOC_ID);
    expect(result.fields).toEqual([]);
    expect(result.meta.source).toBe('none');
    expect(result.meta.reason).toBe(MESSAGES.analyze.failed);
    // Audit is recorded even on failure, capturing source 'none'.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('DOCUMENT_ANALYZED');
    expect(auditCreate.mock.calls[0][0].data.metadata.source).toBe('none');
  });

  it('rejects a non-owner with 403 and never runs the pipeline', async () => {
    const analyze = jest.fn();
    const { service } = makeService({
      document: draftDoc({ ownerId: 'someone-else' }),
      analyze: analyze as never,
    });
    await expect(service.analyze(OWNER, DOC_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('rejects analysis of a non-draft document with 400', async () => {
    const { service } = makeService({
      document: draftDoc({ status: DocumentStatus.IN_PROGRESS }),
    });
    await expect(service.analyze(OWNER, DOC_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown document with 404', async () => {
    const { service } = makeService({ document: null });
    await expect(service.analyze(OWNER, DOC_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
