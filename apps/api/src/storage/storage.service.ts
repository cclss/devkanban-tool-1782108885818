import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { createReadStream, type ReadStream } from 'fs';
import { Readable } from 'stream';
import { join, resolve, isAbsolute } from 'path';
import { randomUUID } from 'crypto';

export interface PresignedUpload {
  /** URL the client PUTs the file bytes to. */
  uploadUrl: string;
  /** HTTP method to use for the upload. */
  method: 'PUT' | 'POST';
  /** Storage key to send back when creating the document. */
  storageKey: string;
  /** Where the bytes end up: cloud S3 or local-disk fallback. */
  driver: 's3' | 'local';
}

/**
 * Object storage abstraction.
 *
 * - When AWS S3 env vars are present, uploads go to S3 and presigned PUT URLs
 *   are issued for direct browser uploads.
 * - Otherwise everything falls back to local disk (STORAGE_DIR), so the full
 *   sender flow works without any cloud credentials.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket?: string;
  private readonly region?: string;
  private readonly localDir: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET') || undefined;
    this.region = this.config.get<string>('AWS_REGION') || undefined;
    const dir = this.config.get<string>('STORAGE_DIR') ?? '.storage';
    this.localDir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  }

  /** True when real S3 credentials/bucket are configured. */
  get usesS3(): boolean {
    return Boolean(
      this.bucket &&
        this.region &&
        this.config.get<string>('AWS_ACCESS_KEY_ID') &&
        this.config.get<string>('AWS_SECRET_ACCESS_KEY'),
    );
  }

  /** Build a unique, namespaced storage key for a user's PDF upload. */
  buildKey(ownerId: string, originalName: string): string {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `documents/${ownerId}/${randomUUID()}-${safe}`;
  }

  /**
   * Build a unique, namespaced storage key for a user's brand logo image.
   *
   * Deliberately namespaced under `branding/` — kept separate from the
   * `documents/` PDF namespace so logo bytes never collide with contract files
   * and the public logo-serving path can be safely restricted to this prefix.
   * The extension carries the (already content-verified) image type so the
   * serving path can derive its `Content-Type` statelessly.
   */
  buildImageKey(ownerId: string, extension: string): string {
    const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    return `branding/${ownerId}/logo-${randomUUID()}.${ext}`;
  }

  /** Derive the wire `Content-Type` for an object from its key extension. */
  contentTypeForKey(key: string): string {
    const lower = key.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  /**
   * Persist raw bytes (used by the multipart upload path).
   *
   * `contentType` defaults to `application/pdf` so existing PDF callers are
   * unchanged; image callers pass the per-file MIME so S3 stores/serves the
   * correct type.
   */
  async save(key: string, data: Buffer, contentType = 'application/pdf'): Promise<void> {
    if (this.usesS3) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({ region: this.region });
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
        }),
      );
      return;
    }

    const full = this.localPath(key);
    await fs.mkdir(join(full, '..'), { recursive: true });
    await fs.writeFile(full, data);
  }

  /** Best-effort delete of an object (used when a logo is replaced/removed). */
  async remove(key: string): Promise<void> {
    if (this.usesS3) {
      const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({ region: this.region });
      await client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return;
    }
    try {
      await fs.unlink(this.localPath(key));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`로컬 객체 삭제 실패 key=${key}: ${String(err)}`);
      }
    }
  }

  /** Read bytes back (used by later grains for PDF rendering / synthesis). */
  async read(key: string): Promise<Buffer> {
    if (this.usesS3) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({ region: this.region });
      const res = await client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    }
    return fs.readFile(this.localPath(key));
  }

  /** Open a read stream for downloads. */
  createReadStream(key: string): ReadStream {
    return createReadStream(this.localPath(key));
  }

  /**
   * Open the object's bytes as a stream, regardless of driver. The S3 driver
   * has no path-based stream, so its bytes are read once and re-wrapped as a
   * Readable; local disk streams directly. Used by every byte download path
   * (signer PDF, completion artifacts) so the S3/local branch lives in one place.
   */
  async openStream(key: string): Promise<Readable> {
    if (this.usesS3) {
      const bytes = await this.read(key);
      return Readable.from(bytes);
    }
    return this.createReadStream(key);
  }

  /**
   * Issue an upload target for direct client uploads.
   * - S3: a presigned PUT URL.
   * - Local: a relative API path the client PUTs to (handled by the controller).
   */
  async createPresignedUpload(ownerId: string, originalName: string): Promise<PresignedUpload> {
    const storageKey = this.buildKey(ownerId, originalName);

    if (this.usesS3) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new S3Client({ region: this.region });
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          ContentType: 'application/pdf',
        }),
        { expiresIn: 60 * 5 },
      );
      return { uploadUrl, method: 'PUT', storageKey, driver: 's3' };
    }

    this.logger.debug(`presign fallback → local storage for key=${storageKey}`);
    return {
      uploadUrl: `/api/documents/upload-local?key=${encodeURIComponent(storageKey)}`,
      method: 'PUT',
      storageKey,
      driver: 'local',
    };
  }

  private localPath(key: string): string {
    // Prevent path traversal out of the storage root.
    const normalized = key.replace(/\.\.(\/|\\|$)/g, '');
    return join(this.localDir, normalized);
  }
}
