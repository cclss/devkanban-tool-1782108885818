import { PDFDocument } from 'pdf-lib';
import {
  AuditCertificateService,
  type AuditCertificateInput,
} from './audit-certificate.service';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

/** A fully-populated, fixed input — all timestamps are literals (deterministic). */
function makeInput(overrides: Partial<AuditCertificateInput> = {}): AuditCertificateInput {
  return {
    document: {
      id: 'doc_abc123',
      title: '용역 위탁 계약서',
      pageCount: 3,
      sentAt: '2026-06-20T01:00:00.000Z',
      completedAt: '2026-06-23T08:30:45.000Z',
    },
    sender: {
      name: '주식회사 토스',
      email: 'sender@toss.im',
      brandColor: null,
    },
    participants: [
      {
        name: '홍길동',
        email: 'hong.gildong@example.com',
        order: 1,
        verificationMethod: '6자리 인증코드',
        signedAt: '2026-06-22T05:10:00.000Z',
      },
      {
        name: '김영희',
        email: 'kim@sample.co.kr',
        order: 2,
        verificationMethod: '6자리 인증코드',
        signedAt: '2026-06-23T08:30:00.000Z',
      },
    ],
    events: [
      { action: 'DOCUMENT_UPLOADED', occurredAt: '2026-06-19T23:00:00.000Z', actorName: '주식회사 토스', actorRole: 'SENDER', ipAddress: '203.0.113.7' },
      { action: 'CONTRACT_SENT', occurredAt: '2026-06-20T01:00:00.000Z', actorName: '주식회사 토스', actorRole: 'SENDER', ipAddress: '203.0.113.7' },
      { action: 'SIGN_REQUEST_VIEWED', occurredAt: '2026-06-22T05:00:00.000Z', actorName: '홍길동', actorRole: 'SIGNER', ipAddress: '198.51.100.23' },
      { action: 'SIGN_REQUEST_VERIFIED', occurredAt: '2026-06-22T05:05:00.000Z', actorName: '홍길동', actorRole: 'SIGNER', ipAddress: '198.51.100.23' },
      { action: 'SIGN_REQUEST_SIGNED', occurredAt: '2026-06-22T05:10:00.000Z', actorName: '홍길동', actorRole: 'SIGNER', ipAddress: '198.51.100.23' },
      { action: 'SIGN_REQUEST_SIGNED', occurredAt: '2026-06-23T08:30:00.000Z', actorName: '김영희', actorRole: 'SIGNER', ipAddress: '2001:db8:85a3:0:0:8a2e:370:7334' },
      { action: 'DOCUMENT_COMPLETED', occurredAt: '2026-06-23T08:30:45.000Z', actorRole: 'SYSTEM' },
    ],
    originalPdfSha256: SHA_A,
    finalPdfSha256: SHA_B,
    issuedAt: '2026-06-23T08:30:45.000Z',
    certificateId: 'CERT-20260623-0001',
    serviceName: '전자계약',
    ...overrides,
  };
}

describe('AuditCertificateService.generate', () => {
  const service = new AuditCertificateService();

  it('produces a valid, non-trivial PDF buffer', async () => {
    const out = await service.generate(makeInput());
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBeGreaterThan(1000);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe('감사 추적 인증서');
  });

  it('is deterministic — identical input yields byte-identical output', async () => {
    const input = makeInput();
    const a = await service.generate(input);
    const b = await service.generate(makeInput()); // fresh, equal input
    expect(a.equals(b)).toBe(true);
  });

  it('changes its bytes when the sender brand color changes', async () => {
    const base = await service.generate(makeInput({ sender: { name: '주식회사 토스', email: 'sender@toss.im', brandColor: null } }));
    const branded = await service.generate(makeInput({ sender: { name: '주식회사 토스', email: 'sender@toss.im', brandColor: '#e94560' } }));
    expect(base.equals(branded)).toBe(false);
  });

  it('flows a long event timeline onto multiple pages with footers', async () => {
    const many = makeInput();
    const base = many.events[2];
    for (let i = 0; i < 60; i++) {
      many.events.push({
        action: 'SIGN_REQUEST_VIEWED',
        occurredAt: `2026-06-22T0${(i % 9) + 1}:0${i % 10}:00.000Z`,
        actorName: base.actorName,
        actorRole: 'SIGNER',
        ipAddress: base.ipAddress,
      });
    }
    const out = await service.generate(many);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('renders without throwing for an unknown action and missing optional fields', async () => {
    const input = makeInput({
      events: [
        { action: 'FUTURE_UNKNOWN_ACTION', occurredAt: '2026-06-23T00:00:00.000Z' },
      ],
      participants: [],
      sender: { name: null, email: 'who@x.io', brandColor: 'not-a-color' },
    });
    const out = await service.generate(input);
    await expect(PDFDocument.load(out)).resolves.toBeDefined();
  });

  it('accepts Date instances as well as ISO strings for timestamps', async () => {
    const fromStrings = await service.generate(makeInput());
    const fromDates = await service.generate(
      makeInput({
        issuedAt: new Date('2026-06-23T08:30:45.000Z'),
        document: {
          id: 'doc_abc123',
          title: '용역 위탁 계약서',
          pageCount: 3,
          sentAt: new Date('2026-06-20T01:00:00.000Z'),
          completedAt: new Date('2026-06-23T08:30:45.000Z'),
        },
      }),
    );
    // Same instants expressed two ways → identical output.
    expect(fromStrings.equals(fromDates)).toBe(true);
  });
});
