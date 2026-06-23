/**
 * End-to-end completion post-processing (grain-5):
 *   send → verify → fill signature → complete (last signer)
 *   → inline post-processing generates the signed PDF + audit certificate,
 *     stores both, emails every participant, and records the artifact keys +
 *     completion time on the Document.
 *
 * Runs with REDIS_URL unset, so the completion queue degrades to the inline
 * fallback (the pipeline finishes synchronously inside `complete()`). Re-running
 * the pipeline for the same document is asserted to be idempotent.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.SES_FROM_EMAIL = '';
process.env.JWT_SECRET = 'e2e-test-secret';
process.env.STORAGE_DIR = `/tmp/esign-e2e-storage-${process.pid}`;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { CompletionQueue } from '../src/completion/completion.queue';

/** A tiny but valid 1×1 PNG, used as the captured signature value. */
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function makePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 800]);
  return Buffer.from(await doc.save());
}

describe('Completion post-processing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let token: string;
  let userId: string;
  let documentId: string;

  const email = `completer_${Date.now()}@example.com`;
  const password = 'password1234';
  const signerEmail = 'completion-signer@example.com';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('drives a contract to the last signature and post-processes it', async () => {
    // 1) Sender registers.
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '발신자주식회사' })
      .expect(201);
    token = reg.body.accessToken;
    userId = reg.body.user.id;

    // 2) Upload a 2-page PDF.
    const pdf = await makePdf(2);
    const upload = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdf, { filename: 'agreement.pdf', contentType: 'application/pdf' })
      .expect(201);
    documentId = upload.body.id;

    // 3) Place one signature field for the only signer.
    await request(app.getHttpServer())
      .put(`/api/documents/${documentId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fields: [{ type: 'SIGNATURE', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.08, recipientIndex: 0 }] })
      .expect(200);

    // 4) Send the contract → creates a sign request with a verify code.
    await request(app.getHttpServer())
      .post(`/api/documents/${documentId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ email: signerEmail, name: '서명자' }] })
      .expect(200);

    const signRequest = await prisma.signRequest.findFirstOrThrow({ where: { documentId } });
    const field = await prisma.signField.findFirstOrThrow({ where: { signRequestId: signRequest.id } });

    // 5) Signer verifies the 6-digit code → session token.
    const verify = await request(app.getHttpServer())
      .post(`/api/signing/${signRequest.accessToken}/verify`)
      .send({ code: signRequest.verifyCode })
      .expect(200);
    const sessionToken = verify.body.sessionToken as string;

    // 6) Signer saves the captured signature value.
    await request(app.getHttpServer())
      .post(`/api/signing/${signRequest.accessToken}/fields`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ fields: [{ fieldId: field.id, value: PNG_1x1 }] })
      .expect(200);

    // 7) Signer completes — last (only) signer → document completes and the
    //    inline pipeline runs synchronously.
    const complete = await request(app.getHttpServer())
      .post(`/api/signing/${signRequest.accessToken}/complete`)
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    expect(complete.body.documentCompleted).toBe(true);

    // The Document is COMPLETED with both artifact keys and a completion time.
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe('COMPLETED');
    expect(doc.signedStorageKey).toBe(`documents/${userId}/completed/${documentId}-signed.pdf`);
    expect(doc.certificateStorageKey).toBe(`documents/${userId}/completed/${documentId}-certificate.pdf`);
    expect(doc.completedAt).toBeTruthy();

    // Both stored artifacts are valid PDFs.
    const signedBytes = await storage.read(doc.signedStorageKey!);
    const certBytes = await storage.read(doc.certificateStorageKey!);
    const signedPdf = await PDFDocument.load(signedBytes);
    expect(signedPdf.getPageCount()).toBe(2);
    const certPdf = await PDFDocument.load(certBytes);
    expect(certPdf.getTitle()).toBe('감사 추적 인증서');
  });

  it('is idempotent — re-running post-processing does not change the record', async () => {
    const before = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });

    // Directly re-enqueue (inline fallback runs it now).
    const queue = app.get(CompletionQueue);
    await queue.enqueue(documentId);

    const after = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(after.completedAt?.getTime()).toBe(before.completedAt?.getTime());
    expect(after.signedStorageKey).toBe(before.signedStorageKey);
    expect(after.certificateStorageKey).toBe(before.certificateStorageKey);
  });
});
