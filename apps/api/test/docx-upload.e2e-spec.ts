/**
 * End-to-end DOCX upload (feature "DOCX 문서 업로드"):
 *   register/login → upload a `.docx` → server converts it to PDF → the
 *   converted PDF becomes the DRAFT's source of truth.
 *
 * Covers the feature scenarios:
 *   1) Success — a valid Korean `.docx` is accepted, converted, and stored as a
 *      DRAFT whose canonical bytes stream back as a real PDF (pageCount +
 *      `GET /documents/:id/file` 정본 조회 asserted), and that converted-PDF
 *      DRAFT then traverses the same 후속 필드 저장 → 발송 pipeline as a native
 *      PDF upload (fields saved → send → 진행 중 / PENDING sign request).
 *   2a) Failure — a corrupt `.docx` fails conversion and the API returns the
 *       exact Korean copy `document.conversionFailed`.
 *   2b) Failure — an unsupported file type (neither PDF nor DOCX) is refused
 *       before conversion with the exact Korean copy `document.invalidFileType`.
 *   Both failure copies are the strings grain-1/grain-2 confirmed and recorded
 *   in `design-spec/messaging/recording.md`; this grain only asserts them (no
 *   new copy is defined here).
 *
 * Environment assumption (documented per grain boundary): the success scenario
 * performs a *real* DOCX→PDF conversion via LibreOffice headless, so it requires
 * the `soffice` binary (bundled in the API Docker image / present in CI). When
 * `soffice` cannot be resolved (e.g. a bare dev sandbox) the success test is
 * skipped with a logged notice — it is NOT silently passed. The failure test
 * always runs: a corrupt file fails conversion whether soffice is present
 * (invalid zip) or absent (binary not found), and both surface the same
 * `conversionFailed` copy.
 */

// Point Prisma at the dedicated test database BEFORE the app (and its Prisma
// client) initialize — mirrors sender-flow.e2e-spec.ts.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'e2e-test-secret';
// Isolate local-disk storage for this run so uploads don't collide with others.
process.env.STORAGE_DIR = `/tmp/esign-docx-e2e-storage-${process.pid}`;

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGES } from '../src/common/messages';

/** MIME type browsers report for a `.docx` (OOXML WordprocessingML) file. */
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The exact user-facing conversion-failure copy, quoted verbatim from the
 * Design Spec messaging record (`design-spec/messaging/recording.md` →
 * "적용 결정 — `document.conversionFailed` (2026-07-07)"). The failure scenario
 * must surface this string byte-for-byte. Kept as a literal here — rather than
 * only reading `MESSAGES` — so the assertion pins the response to the *recorded*
 * copy; the `toBe` below then proves code (`common/messages.ts`) and spec agree.
 */
const CONVERSION_FAILED_COPY =
  '문서를 변환하지 못했어요. 파일이 손상되었거나 지원하지 않는 형식일 수 있어요. 다른 파일로 다시 시도해 주세요.';

/**
 * The exact user-facing "unsupported format" copy, quoted verbatim from the
 * Design Spec messaging record (`design-spec/messaging/recording.md` →
 * "업로드 수용 형식 확장 — 기존 오류 카피 갱신 (2026-07-07)" → `document.invalidFileType`).
 * When multipart upload started accepting DOCX (converted to PDF server-side)
 * alongside PDF, this copy was widened from "PDF 파일만…" to "PDF 또는 DOCX…".
 * A non-PDF/non-DOCX upload must surface this string byte-for-byte — as with the
 * conversion copy above, the `toBe` reference check below proves code
 * (`common/messages.ts`) and spec agree; this grain defines no new copy.
 */
const INVALID_FILE_TYPE_COPY = 'PDF 또는 DOCX 파일만 업로드할 수 있어요.';

/** Committed valid Korean `.docx` fixture (see test/fixtures/README.md). */
const KOREAN_DOCX = readFileSync(join(__dirname, 'fixtures', 'korean-contract.docx'));

/**
 * Resolve the LibreOffice `soffice` binary the real converter would use, or
 * `null` if none is installed. Mirrors the provider's resolution order
 * (`LIBREOFFICE_BIN` → common install paths → `PATH`).
 */
function resolveSoffice(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_BIN,
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) if (existsSync(p)) return p;
  for (const bin of ['soffice', 'libreoffice']) {
    try {
      const p = execFileSync('/bin/sh', ['-c', `command -v ${bin}`])
        .toString()
        .trim();
      if (p && existsSync(p)) return p;
    } catch {
      // binary not on PATH — keep looking.
    }
  }
  return null;
}

const SOFFICE = resolveSoffice();
/** Run the real-conversion success test only where soffice is available. */
const itIfSoffice = SOFFICE ? it : it.skip;

describe('DOCX upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  const email = `docx_${Date.now()}@example.com`;
  const password = 'password1234';

  beforeAll(async () => {
    if (!SOFFICE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[docx-upload.e2e] soffice(LibreOffice) 미설치 — 실변환 성공 시나리오를 건너뜁니다. ' +
          'CI/Docker(libreoffice-writer + fonts-nanum) 환경에서 실행하세요.',
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: '테스터' })
      .expect(201);
    token = res.body.accessToken;
    userId = res.body.user.id;
  });

  afterAll(async () => {
    if (userId) {
      // Cascades clean up documents / audit logs created during the run.
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('keeps the code copy in sync with the recorded conversionFailed message', () => {
    // Reference check: the string asserted below must equal the copy grain-1
    // confirmed and recorded in design-spec/messaging/recording.md, and the
    // shipped code (common/messages.ts) must serve exactly that copy.
    expect(MESSAGES.document.conversionFailed).toBe(CONVERSION_FAILED_COPY);
  });

  it('keeps the code copy in sync with the recorded invalidFileType message', () => {
    // Reference check: the string asserted below must equal the copy grain-2
    // widened (PDF → "PDF 또는 DOCX") and recorded in
    // design-spec/messaging/recording.md, and the shipped code
    // (common/messages.ts) must serve exactly that copy.
    expect(MESSAGES.document.invalidFileType).toBe(INVALID_FILE_TYPE_COPY);
  });

  // --- Scenario 1: successful DOCX upload (requires real soffice) ----------
  itIfSoffice(
    'accepts a valid Korean .docx, converts it to PDF, and stores it as a DRAFT',
    async () => {
      const upload = await request(app.getHttpServer())
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', KOREAN_DOCX, {
          filename: 'korean-contract.docx',
          contentType: DOCX_MIME,
        })
        .expect(201);

      // The DRAFT describes the converted PDF, not the original DOCX.
      expect(upload.body.id).toBeDefined();
      expect(upload.body.status).toBe('DRAFT');
      expect(upload.body.statusLabel).toBe('작성 중');
      // Page count comes from the converted PDF; the fixture renders to >= 1 page.
      expect(typeof upload.body.pageCount).toBe('number');
      expect(upload.body.pageCount).toBeGreaterThanOrEqual(1);
      // Title is derived from the uploaded filename with the .docx extension stripped.
      expect(upload.body.title).toBe('korean-contract');
      const documentId: string = upload.body.id;

      // 정본 조회: the stored canonical bytes stream back as a real PDF whose
      // page count matches what the DRAFT reported (source of truth == PDF).
      const file = await request(app.getHttpServer())
        .get(`/api/documents/${documentId}/file`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((stream, cb) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(file.headers['content-type']).toContain('application/pdf');
      const reloaded = await PDFDocument.load(file.body as Buffer);
      expect(reloaded.getPageCount()).toBe(upload.body.pageCount);

      // The stored document persists as a DRAFT owned by the uploader.
      const stored = await prisma.document.findUnique({ where: { id: documentId } });
      expect(stored?.status).toBe('DRAFT');
      expect(stored?.ownerId).toBe(userId);
      expect(stored?.pageCount).toBe(upload.body.pageCount);

      // --- 후속 필드 저장 → 발송 파이프라인 통과 ------------------------------
      // The converted-PDF DRAFT must flow through the exact same pipeline as a
      // native PDF upload (see sender-flow.e2e-spec.ts): place a sign field on
      // the converted PDF, then send. It ends 진행 중 (IN_PROGRESS) with a
      // PENDING sign request that owns the placed field — proving the converted
      // PDF is a first-class source of truth for every downstream step.
      const savedFields = await request(app.getHttpServer())
        .put(`/api/documents/${documentId}/fields`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: [
            {
              type: 'SIGNATURE',
              page: 1,
              x: 0.1,
              y: 0.2,
              width: 0.3,
              height: 0.08,
              recipientIndex: 0,
            },
          ],
        })
        .expect(200);
      expect(savedFields.body.count).toBe(1);

      const sent = await request(app.getHttpServer())
        .post(`/api/documents/${documentId}/send`)
        .set('Authorization', `Bearer ${token}`)
        .send({ recipients: [{ email: 'signer@example.com', name: '서명자' }] })
        .expect(200);
      expect(sent.body.status).toBe('IN_PROGRESS');
      expect(sent.body.statusLabel).toBe('진행 중');
      expect(sent.body.recipientCount).toBe(1);
      expect(sent.body.sentAt).toBeTruthy();

      // A single PENDING sign request was created and the placed field bound to it.
      const signRequests = await prisma.signRequest.findMany({ where: { documentId } });
      expect(signRequests).toHaveLength(1);
      expect(signRequests[0].status).toBe('PENDING');
      const boundFields = await prisma.signField.findMany({ where: { documentId } });
      expect(boundFields).toHaveLength(1);
      expect(boundFields.every((f) => f.signRequestId === signRequests[0].id)).toBe(true);
    },
  );

  // --- Scenario 2: conversion failure --------------------------------------
  it('rejects a corrupt/unsupported .docx with the recorded Korean conversion error', async () => {
    // A file that carries the DOCX declaration (`.docx` + OOXML MIME) and the
    // ZIP magic (`PK`) so it is classified as a DOCX and reaches the converter,
    // but whose bytes are not a valid OOXML package — conversion fails.
    const corruptDocx = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.from('this is not a real docx package — conversion must fail'),
    ]);

    const before = await prisma.document.count({ where: { ownerId: userId } });

    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', corruptDocx, {
        filename: 'broken.docx',
        contentType: DOCX_MIME,
      })
      .expect(400);

    // Exact match against the copy recorded in the Design Spec messaging record.
    expect(res.body.message).toBe(CONVERSION_FAILED_COPY);

    // A failed conversion must not persist a document (conversion happens before
    // the DRAFT row is created).
    const after = await prisma.document.count({ where: { ownerId: userId } });
    expect(after).toBe(before);
  });

  // --- Scenario 2b: unsupported file type ----------------------------------
  it('rejects an unsupported file type with the recorded Korean invalidFileType copy', async () => {
    // A plain-text file is neither a PDF (`%PDF-`) nor a DOCX (`PK` OOXML zip),
    // so format detection classifies it as neither and the upload is refused up
    // front — before any conversion is attempted (distinct from a corrupt DOCX,
    // which reaches the converter and fails with `conversionFailed`).
    const before = await prisma.document.count({ where: { ownerId: userId } });

    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('이것은 계약서가 아닌 일반 텍스트예요.'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    // Exact match against the copy recorded in the Design Spec messaging record.
    expect(res.body.message).toBe(INVALID_FILE_TYPE_COPY);

    // A rejected upload must not persist a document.
    const after = await prisma.document.count({ where: { ownerId: userId } });
    expect(after).toBe(before);
  });
});
