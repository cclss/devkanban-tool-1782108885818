/**
 * End-to-end proof of the full chain the frontend's `prepareTemplate`
 * (`new-contract-start.tsx`) walks when a sender picks "이 템플릿으로 발송
 * 시작" from the template list:
 *
 *   템플릿 생성(필드 배치 포함) → storageKey로 새 DRAFT 문서 등록
 *   → 템플릿의 필드 배치를 그대로 문서에 저장 → 수신자 지정 → 발송 완료
 *
 * Each individual step (template CRUD, presigned document creation, field
 * save, send) already has its own coverage elsewhere
 * (`templates-flow.e2e-spec.ts`, `sender-flow.e2e-spec.ts`). What has never
 * been proven is that they chain together without a break: the template's
 * original PDF (storageKey) and its saved field layout survive unchanged
 * into a brand-new document, and that document can be carried from
 * recipient assignment through to a completed send in one uninterrupted
 * sequence (스펙 M-3, M-6).
 *
 * This spec makes no changes to `src` — the chain already works; this test
 * only fixes it in place so a future regression in any single link is
 * caught here first.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'e2e-test-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

async function makePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

describe('Template → wizard → send chain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let token: string;
  let userId: string;

  const email = `tmplchain_${Date.now()}@example.com`;
  const password = 'password1234';

  // Mirrors the geometry shape `SignFieldDto` accepts, with two distinct
  // recipientIndex values (0 and 1) so the send step below must prove the
  // "leftover fields default to the first signer" rule still lands both
  // fields on the single recipient actually supplied.
  const templateFields = [
    { type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 },
    { type: 'DATE', page: 2, x: 0.5, y: 0.6, width: 0.2, height: 0.05, recipientIndex: 1 },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '체인테스터' })
      .expect(201);
    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await app.close();
  });

  it('chains template → new document → fields → send without interruption', async () => {
    // --- Step 1: a template exists with a source PDF and placed fields,
    // exactly as if it had been saved from a prior wizard session. -----
    const storageKey = `templates/${userId}/std-template.pdf`;
    const pdfBytes = await makePdf(2);
    await storage.save(storageKey, pdfBytes);

    const templateRes = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '표준 근로계약서 템플릿',
        storageKey,
        pageCount: 2,
        fields: templateFields,
      })
      .expect(201);

    const template = templateRes.body;
    expect(template.id).toBeDefined();
    expect(template.storageKey).toBe(storageKey);
    expect(template.fields).toHaveLength(2);

    // --- Step 2: "이 템플릿으로 발송 시작" → prepareTemplate's
    // createDocumentFromStorageKey({ storageKey, title, pageCount }). -----
    const documentRes = await request(app.getHttpServer())
      .post('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        storageKey: template.storageKey,
        title: template.name,
        ...(template.pageCount > 0 ? { pageCount: template.pageCount } : {}),
      })
      .expect(201);

    const documentId: string = documentRes.body.id;
    expect(documentRes.body.status).toBe('DRAFT');
    expect(documentRes.body.statusLabel).toBe('작성 중');
    // The template's page count carried over untouched — no re-parsing was
    // needed because the wizard already knows it from the template record.
    expect(documentRes.body.pageCount).toBe(template.pageCount);

    // The new document points at the *same* storage object as the template
    // — the original PDF is reused, not re-uploaded or copied.
    const storedDocument = await prisma.document.findUnique({ where: { id: documentId } });
    expect(storedDocument?.storageKey).toBe(storageKey);
    expect(storedDocument?.ownerId).toBe(userId);

    // --- Step 3: the template's saved field layout is submitted as-is —
    // no re-placement, exactly what the wizard does with an already-placed
    // template (fields are only ever read from `template.fields`, never
    // edited before this PUT in the reuse path). -----
    const fieldsRes = await request(app.getHttpServer())
      .put(`/api/documents/${documentId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fields: template.fields })
      .expect(200);
    expect(fieldsRes.body.count).toBe(2);

    const savedFields = await prisma.signField.findMany({
      where: { documentId },
      orderBy: { recipientIndex: 'asc' },
    });
    expect(savedFields).toHaveLength(2);
    expect(savedFields[0]).toMatchObject({
      type: 'SIGNATURE',
      page: 1,
      recipientIndex: 0,
    });
    expect(savedFields[0].x).toBeCloseTo(0.1);
    expect(savedFields[0].y).toBeCloseTo(0.2);
    expect(savedFields[1]).toMatchObject({
      type: 'DATE',
      page: 2,
      recipientIndex: 1,
    });
    expect(savedFields[1].x).toBeCloseTo(0.5);
    expect(savedFields[1].y).toBeCloseTo(0.6);

    // --- Step 4: recipient assignment → send, in the same uninterrupted
    // sequence — no re-fetch of the document, no separate session. -----
    const sendRes = await request(app.getHttpServer())
      .post(`/api/documents/${documentId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: 'signer@example.com', name: '서명자' }] })
      .expect(200);

    expect(sendRes.body.status).toBe('IN_PROGRESS');
    expect(sendRes.body.statusLabel).toBe('진행 중');
    expect(sendRes.body.recipientCount).toBe(1);
    expect(sendRes.body.sentAt).toBeTruthy();

    // Exactly one sign request was created for the single recipient
    // supplied, and both fields — despite carrying two distinct
    // recipientIndex values (0 and 1) inherited from the template — ended
    // up attached to that one request (the "leftover fields default to the
    // first signer" rule), proving the field layout is fully connected to
    // the completed send.
    const signRequests = await prisma.signRequest.findMany({ where: { documentId } });
    expect(signRequests).toHaveLength(1);
    expect(signRequests[0].status).toBe('PENDING');
    expect(signRequests[0].recipientEmail).toBe('signer@example.com');

    const fieldsAfterSend = await prisma.signField.findMany({ where: { documentId } });
    expect(fieldsAfterSend).toHaveLength(2);
    expect(fieldsAfterSend.every((f) => f.signRequestId === signRequests[0].id)).toBe(true);

    const sentAudit = await prisma.auditLog.findFirst({
      where: { documentId, action: 'CONTRACT_SENT' },
    });
    expect(sentAudit).toBeTruthy();
    expect(sentAudit?.actorId).toBe(userId);

    // The document is now visible on the dashboard as 진행 중 — the whole
    // chain (템플릿 선택 → 수신자 지정 → 발송 완료) is done.
    const listRes = await request(app.getHttpServer())
      .get('/api/documents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = listRes.body.find((d: { id: string }) => d.id === documentId);
    expect(found).toBeDefined();
    expect(found.statusLabel).toBe('진행 중');
  });
});
