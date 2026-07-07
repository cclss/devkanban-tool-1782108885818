import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { DocumentsService } from './documents.service';
import { MESSAGES } from '../common/messages';

/**
 * Focused unit tests for `openDocumentFile` — the owner-only retrieval of a
 * document's stored canonical PDF (native upload or DOCX→PDF conversion) that
 * the DRAFT preview and field placement render against. Prisma + storage are
 * faked so only the ownership check + stream wiring are under test. This path is
 * deliberately independent of `openArtifact` (COMPLETED-only artifacts).
 */

/** Assemble a DocumentsService with just the collaborators this path touches. */
function makeService(doc: { ownerId: string; storageKey: string } | null) {
  const prisma = {
    document: { findUnique: jest.fn(async () => doc) },
  };
  const openStream = jest.fn(async (key: string) => {
    // Return a distinct stream tagged with the key so the test can assert the
    // service opened the document's own storageKey.
    const stream = Readable.from(Buffer.from(`bytes-for:${key}`)) as Readable & {
      forKey?: string;
    };
    stream.forKey = key;
    return stream;
  });
  const storage = { openStream };

  const service = new DocumentsService(
    prisma as any,
    storage as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, storage };
}

describe('DocumentsService.openDocumentFile — owner-only draft PDF retrieval', () => {
  it('streams the stored canonical PDF for the owner via storage.openStream', async () => {
    const { service, storage } = makeService({
      ownerId: 'user-1',
      storageKey: 'documents/user-1/abc.pdf',
    });

    const stream = (await service.openDocumentFile('user-1', 'doc-1')) as Readable & {
      forKey?: string;
    };

    expect(storage.openStream).toHaveBeenCalledWith('documents/user-1/abc.pdf');
    expect(stream.forKey).toBe('documents/user-1/abc.pdf');
  });

  it('rejects a non-owner with forbidden and never opens the bytes', async () => {
    const { service, storage } = makeService({
      ownerId: 'owner-1',
      storageKey: 'documents/owner-1/abc.pdf',
    });

    await expect(service.openDocumentFile('intruder-2', 'doc-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.openDocumentFile('intruder-2', 'doc-1')).rejects.toThrow(
      MESSAGES.document.forbidden,
    );
    expect(storage.openStream).not.toHaveBeenCalled();
  });

  it('reports notFound for a missing document without opening any bytes', async () => {
    const { service, storage } = makeService(null);

    await expect(service.openDocumentFile('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.openDocumentFile('user-1', 'missing')).rejects.toThrow(
      MESSAGES.document.notFound,
    );
    expect(storage.openStream).not.toHaveBeenCalled();
  });
});
