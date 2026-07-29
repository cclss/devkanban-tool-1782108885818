import { ForbiddenException } from '@nestjs/common';
import { DocumentStatus, SignRequestStatus } from '@repo/db';
import { SigningService } from './signing.service';
import { MESSAGES } from '../common/messages';

/**
 * Policy coverage for M-8: a signing link is signable ONLY while the document
 * is IN_PROGRESS. DRAFT links (document never dispatched) must be blocked on
 * every signer path — meta/verify/payload/save/complete — with `notSignable`.
 * These are non-UI checks against the `isSignable` gate the five paths share.
 */
describe('SigningService — signable gating (M-8)', () => {
  const ACCESS = 'tok_draft';
  const SR_ID = 'sr_1';

  interface StubRow {
    id: string;
    accessToken: string;
    status: SignRequestStatus;
    verifyCode: string;
    recipientName: string;
    document: {
      id: string;
      title: string;
      pageCount: number;
      status: DocumentStatus;
      owner: { name: string; brandColor: string | null; brandLogoUrl: string | null };
    };
    signFields: Array<{ id: string; value: string | null; type: string }>;
  }

  function build(documentStatus: DocumentStatus, requestStatus = SignRequestStatus.PENDING) {
    const row: StubRow = {
      id: SR_ID,
      accessToken: ACCESS,
      status: requestStatus,
      verifyCode: '123456',
      recipientName: '홍길동',
      document: {
        id: 'doc_1',
        title: '계약서',
        pageCount: 1,
        status: documentStatus,
        owner: { name: '보내는 사람', brandColor: null, brandLogoUrl: null },
      },
      signFields: [{ id: 'f1', value: null, type: 'SIGNATURE' }],
    };
    const prisma = {
      signRequest: {
        // Both include- and select-shaped reads resolve to the same row; the
        // gate under test runs before any field-shape divergence matters.
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
      auditLog: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
    };
    const service = new SigningService(
      prisma as never,
      {} as never,
      { issue: jest.fn().mockReturnValue('sess') } as never,
      { enqueue: jest.fn() } as never,
    );
    return { service, prisma };
  }

  describe('isSignable matrix', () => {
    const call = (svc: SigningService, doc: DocumentStatus, req: SignRequestStatus) =>
      (svc as unknown as { isSignable: (d: DocumentStatus, r: SignRequestStatus) => boolean }).isSignable(
        doc,
        req,
      );

    it('allows IN_PROGRESS for open requests', () => {
      const { service } = build(DocumentStatus.IN_PROGRESS);
      expect(call(service, DocumentStatus.IN_PROGRESS, SignRequestStatus.PENDING)).toBe(true);
      expect(call(service, DocumentStatus.IN_PROGRESS, SignRequestStatus.VIEWED)).toBe(true);
    });

    it('blocks DRAFT (never dispatched) even for open requests', () => {
      const { service } = build(DocumentStatus.DRAFT);
      expect(call(service, DocumentStatus.DRAFT, SignRequestStatus.PENDING)).toBe(false);
      expect(call(service, DocumentStatus.DRAFT, SignRequestStatus.VIEWED)).toBe(false);
    });

    it('blocks COMPLETED / CANCELLED', () => {
      const { service } = build(DocumentStatus.COMPLETED);
      expect(call(service, DocumentStatus.COMPLETED, SignRequestStatus.PENDING)).toBe(false);
      expect(call(service, DocumentStatus.CANCELLED, SignRequestStatus.PENDING)).toBe(false);
    });

    it('blocks already-terminal requests regardless of IN_PROGRESS document', () => {
      const { service } = build(DocumentStatus.IN_PROGRESS);
      expect(call(service, DocumentStatus.IN_PROGRESS, SignRequestStatus.SIGNED)).toBe(false);
      expect(call(service, DocumentStatus.IN_PROGRESS, SignRequestStatus.DECLINED)).toBe(false);
    });
  });

  describe('DRAFT link is blocked on every signer path', () => {
    it('meta() reports signable=false', async () => {
      const { service } = build(DocumentStatus.DRAFT);
      const meta = await service.meta(ACCESS);
      expect(meta.signable).toBe(false);
      expect(meta.documentStatus).toBe(DocumentStatus.DRAFT);
    });

    it('verify() throws notSignable', async () => {
      const { service } = build(DocumentStatus.DRAFT);
      await expect(service.verify(ACCESS, '123456')).rejects.toMatchObject({
        message: MESSAGES.signing.notSignable,
      });
      await expect(service.verify(ACCESS, '123456')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('payload() throws notSignable', async () => {
      const { service } = build(DocumentStatus.DRAFT);
      await expect(service.payload(SR_ID)).rejects.toMatchObject({
        message: MESSAGES.signing.notSignable,
      });
    });

    it('saveFields() throws notSignable', async () => {
      const { service } = build(DocumentStatus.DRAFT);
      await expect(
        service.saveFields(SR_ID, { fields: [{ fieldId: 'f1', value: 'x' }] }),
      ).rejects.toMatchObject({ message: MESSAGES.signing.notSignable });
    });

    it('complete() throws notSignable', async () => {
      const { service } = build(DocumentStatus.DRAFT);
      await expect(service.complete(SR_ID)).rejects.toMatchObject({
        message: MESSAGES.signing.notSignable,
      });
    });
  });

  describe('IN_PROGRESS link is not blocked by the gate', () => {
    it('meta() reports signable=true', async () => {
      const { service } = build(DocumentStatus.IN_PROGRESS);
      const meta = await service.meta(ACCESS);
      expect(meta.signable).toBe(true);
    });

    it('verify() proceeds past the gate and issues a session', async () => {
      const { service } = build(DocumentStatus.IN_PROGRESS);
      const result = await service.verify(ACCESS, '123456');
      expect(result.sessionToken).toBe('sess');
    });
  });
});
