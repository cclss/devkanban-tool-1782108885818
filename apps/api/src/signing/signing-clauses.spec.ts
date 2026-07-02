import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ClauseExtractionStatus } from '@repo/db';
import { SigningController } from './signing.controller';
import { SignerSessionGuard } from './signer-session.guard';
import { SigningService } from './signing.service';

/** Build a SigningService with only the prisma dependency the method uses. */
function makeService(prisma: unknown): SigningService {
  return new SigningService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const DOCUMENT_ID = 'doc-1';
const SIGN_REQUEST_ID = 'sr-1';

function prismaWith(clauseStatus: ClauseExtractionStatus, rows: unknown[]) {
  return {
    signRequest: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ document: { id: DOCUMENT_ID, clauseStatus } }),
    },
    contractClause: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

describe('SigningService.clauses — cached clause cards contract', () => {
  it('returns READY cards ordered by `order` asc, snippet not exposed', async () => {
    const rows = [
      {
        title: '자동 갱신',
        summary: '자동으로 갱신될 수 있어요.',
        sourcePage: 2,
        caution: true,
        cautionReason: '자동 갱신 조항이에요. 갱신·해지 시점을 미리 확인해 주세요.',
      },
      {
        title: '계약 기간',
        summary: '계약이 유지되는 기간이에요.',
        sourcePage: 1,
        caution: false,
        cautionReason: null,
      },
    ];
    const prisma = prismaWith(ClauseExtractionStatus.READY, rows);

    const result = await makeService(prisma).clauses(SIGN_REQUEST_ID);

    expect(result.status).toBe('READY');
    expect(result.clauses).toEqual([
      {
        title: '자동 갱신',
        summary: '자동으로 갱신될 수 있어요.',
        sourcePage: 2,
        caution: true,
        cautionReason: '자동 갱신 조항이에요. 갱신·해지 시점을 미리 확인해 주세요.',
      },
      {
        title: '계약 기간',
        summary: '계약이 유지되는 기간이에요.',
        sourcePage: 1,
        caution: false,
        cautionReason: null,
      },
    ]);
    // No verbatim source snippet leaks into the card payload.
    expect(JSON.stringify(result.clauses)).not.toContain('sourceSnippet');
    expect(prisma.contractClause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: DOCUMENT_ID },
        orderBy: { order: 'asc' },
      }),
    );
  });

  it.each([
    ClauseExtractionStatus.EMPTY,
    ClauseExtractionStatus.FAILED,
    ClauseExtractionStatus.PENDING,
  ])(
    'returns an empty array for %s without reading clause rows (fallback signal)',
    async (status) => {
      const prisma = prismaWith(status, []);

      const result = await makeService(prisma).clauses(SIGN_REQUEST_ID);

      expect(result.status).toBe(status);
      expect(result.clauses).toEqual([]);
      // Non-READY short-circuits: it must not query the clause cache.
      expect(prisma.contractClause.findMany).not.toHaveBeenCalled();
    },
  );

  it('downgrades a READY status with zero rows to EMPTY', async () => {
    const prisma = prismaWith(ClauseExtractionStatus.READY, []);

    const result = await makeService(prisma).clauses(SIGN_REQUEST_ID);

    expect(result.status).toBe('EMPTY');
    expect(result.clauses).toEqual([]);
  });

  it('throws NotFound when the sign request cannot be resolved', async () => {
    const prisma = {
      signRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      contractClause: { findMany: jest.fn() },
    };

    await expect(makeService(prisma).clauses(SIGN_REQUEST_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.contractClause.findMany).not.toHaveBeenCalled();
  });
});

describe('SigningController — clauses route session guard', () => {
  it('protects `:token/clauses` with SignerSessionGuard (no session → rejected)', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, SigningController.prototype.clauses) ?? [];
    expect(guards).toContain(SignerSessionGuard);
  });
});
