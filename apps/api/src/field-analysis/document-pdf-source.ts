import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Port that resolves a document's original PDF bytes by id. Upload-time analysis
 * already has the bytes in hand, but the consent-driven premium run
 * ({@link FieldAnalysisService.runPremiumAnalysis}) only gets a `documentId`, so
 * it re-reads the stored bytes through this seam. Kept behind a token so the
 * orchestration stays unit-testable without a database or object store.
 */
export interface DocumentPdfSource {
  /**
   * Load a document's PDF bytes, or `null` when the document is unknown or its
   * bytes cannot be read. Implementations must not throw — a null result is
   * treated as an unavailable premium path.
   */
  load(documentId: string): Promise<Buffer | null>;
}

/** DI token for the {@link DocumentPdfSource} binding. */
export const DOCUMENT_PDF_SOURCE = Symbol('DOCUMENT_PDF_SOURCE');

/**
 * Default binding: look up the document's `storageKey` and read the bytes from
 * the object store. Any failure (missing document, unreadable object) resolves to
 * `null` so the premium run degrades to an `unavailable` Vision path instead of
 * crashing.
 */
@Injectable()
export class StorageDocumentPdfSource implements DocumentPdfSource {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async load(documentId: string): Promise<Buffer | null> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { storageKey: true },
    });
    if (!doc) return null;
    try {
      return await this.storage.read(doc.storageKey);
    } catch {
      return null;
    }
  }
}
