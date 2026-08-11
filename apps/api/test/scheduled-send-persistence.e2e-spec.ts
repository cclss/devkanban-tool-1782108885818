/**
 * Scheduled-send data-layer persistence (grain-2).
 *
 * Verifies the reservation columns and the new `DocumentStatus.SCHEDULED`
 * survive a create → read round-trip against a real PostgreSQL database.
 * Scope is the persistence layer only (schema · status · job linkage);
 * delayed-job registration, auto-dispatch and cancel/reschedule APIs are
 * built on top of this layer in later grains.
 *
 * Maps to spec `planning/spec-scheduled-send-schema.md` Measures M1–M5 and
 * scenarios S1–S3.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hermes@localhost/esign_test?host=/var/run/postgresql&schema=public';

import { PrismaClient, DocumentStatus } from '@repo/db';
import { DOCUMENT_STATUS_LABEL } from '../src/documents/document-status';

describe('Scheduled-send persistence (e2e)', () => {
  const prisma = new PrismaClient();
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `scheduler_${Date.now()}@example.com`, name: 'Scheduler' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  // S1 → M1/M2/M3: a scheduled document round-trips every reservation value.
  it('persists scheduledSendAt, SCHEDULED status and scheduledJobId (M1–M3)', async () => {
    const scheduledSendAt = new Date('2099-01-02T03:04:05.678Z');
    const scheduledJobId = `send:doc-${Date.now()}`;

    const created = await prisma.document.create({
      data: {
        ownerId: userId,
        title: 'Deferred contract',
        storageKey: 'stub/deferred.pdf',
        status: DocumentStatus.SCHEDULED,
        scheduledSendAt,
        scheduledJobId,
      },
    });

    const found = await prisma.document.findUnique({ where: { id: created.id } });

    expect(found).not.toBeNull();
    // M1 — millisecond-exact round-trip of the target send time.
    expect(found!.scheduledSendAt?.getTime()).toBe(scheduledSendAt.getTime());
    // M2 — the new enum value persists and reads back.
    expect(found!.status).toBe(DocumentStatus.SCHEDULED);
    expect(found!.status).toBe('SCHEDULED');
    // M3 — the BullMQ job id is stored verbatim.
    expect(found!.scheduledJobId).toBe(scheduledJobId);
  });

  // S2 → M4: the job id is a usable reverse lookup key (cancel/reschedule hook).
  it('finds the document by its scheduledJobId (M4)', async () => {
    const scheduledJobId = `send:lookup-${Date.now()}`;
    const created = await prisma.document.create({
      data: {
        ownerId: userId,
        title: 'Lookup contract',
        storageKey: 'stub/lookup.pdf',
        status: DocumentStatus.SCHEDULED,
        scheduledSendAt: new Date('2099-06-07T08:09:10.011Z'),
        scheduledJobId,
      },
    });

    const byJob = await prisma.document.findFirst({ where: { scheduledJobId } });

    expect(byJob).not.toBeNull();
    expect(byJob!.id).toBe(created.id);
  });

  // S3 → M5: additive migration — un-scheduled documents are unaffected.
  it('leaves non-scheduled documents null with the default status (M5)', async () => {
    const created = await prisma.document.create({
      data: {
        ownerId: userId,
        title: 'Plain contract',
        storageKey: 'stub/plain.pdf',
      },
    });

    const found = await prisma.document.findUnique({ where: { id: created.id } });

    expect(found!.scheduledSendAt).toBeNull();
    expect(found!.scheduledJobId).toBeNull();
    expect(found!.status).toBe(DocumentStatus.DRAFT);
  });

  // Status-label constant stays total over the extended enum.
  it('exposes a Korean label for the SCHEDULED status', () => {
    expect(DOCUMENT_STATUS_LABEL[DocumentStatus.SCHEDULED]).toBe('예약됨');
    // Every enum member has a label (Record totality).
    for (const status of Object.values(DocumentStatus)) {
      expect(DOCUMENT_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
