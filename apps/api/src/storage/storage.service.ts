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

  /** Build a unique, namespaced storage key for a user's upload. */
  buildKey(ownerId: string, originalName: string): string {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `documents/${ownerId}/${randomUUID()}-${safe}`;
  }

  /**
   * Build a storage key for a service-wide branding asset (logo/favicon).
   * Branding is global (not per-user), so keys are namespaced by asset kind
   * rather than owner. A fresh UUID per upload avoids cache/overwrite races
   * when the admin replaces an asset.
   */
  buildBrandingKey(asset: 'logo' | 'favicon', originalName: string): string {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `branding/${asset}/${randomUUID()}-${safe}`;
  }

  /**
   * Persist raw bytes (used by the multipart upload path).
   *
   * `contentType` defaults to `application/pdf` to preserve the original
   * document-upload behaviour; branding callers pass the image MIME (e.g.
   * `image/svg+xml`, `image/png`) so the object is stored/served correctly.
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
  async createPresignedUpload(
    ownerId: string,
    originalName: string,
    contentType = 'application/pdf',
  ): Promise<PresignedUpload> {
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
          ContentType: contentType,
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
