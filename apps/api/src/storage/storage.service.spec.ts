import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StorageService } from './storage.service';

function makeService(storageDir: string): StorageService {
  const config = {
    get: (key: string) => (key === 'STORAGE_DIR' ? storageDir : undefined),
  } as unknown as ConfigService;
  return new StorageService(config);
}

describe('StorageService image helpers', () => {
  it('namespaces logo keys under branding/<ownerId>/ with the given extension', () => {
    const svc = makeService('.storage-test');
    const key = svc.buildImageKey('user_42', 'png');
    expect(key).toMatch(/^branding\/user_42\/logo-[0-9a-f-]+\.png$/);
  });

  it('keeps logo keys separate from document keys', () => {
    const svc = makeService('.storage-test');
    expect(svc.buildKey('user_42', 'a.pdf')).toMatch(/^documents\//);
    expect(svc.buildImageKey('user_42', 'png')).toMatch(/^branding\//);
  });

  it('sanitizes the extension and falls back to bin', () => {
    const svc = makeService('.storage-test');
    expect(svc.buildImageKey('u', '../svg')).toMatch(/\.svg$/);
    expect(svc.buildImageKey('u', '')).toMatch(/\.bin$/);
  });

  it('derives content type from the key extension', () => {
    const svc = makeService('.storage-test');
    expect(svc.contentTypeForKey('branding/u/logo-x.png')).toBe('image/png');
    expect(svc.contentTypeForKey('branding/u/logo-x.jpg')).toBe('image/jpeg');
    expect(svc.contentTypeForKey('branding/u/logo-x.jpeg')).toBe('image/jpeg');
    expect(svc.contentTypeForKey('branding/u/logo-x.svg')).toBe('image/svg+xml');
    expect(svc.contentTypeForKey('documents/u/x.pdf')).toBe('application/pdf');
    expect(svc.contentTypeForKey('branding/u/logo-x.bin')).toBe('application/octet-stream');
  });
});

describe('StorageService local save/remove (image bytes)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'branding-store-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saves bytes (content type arg is a no-op for local disk) and reads them back', async () => {
    const svc = makeService(dir);
    const key = svc.buildImageKey('user_1', 'png');
    await svc.save(key, Buffer.from('PNGDATA'), 'image/png');
    expect((await svc.read(key)).toString()).toBe('PNGDATA');
  });

  it('remove deletes a stored object and is a no-op when missing', async () => {
    const svc = makeService(dir);
    const key = svc.buildImageKey('user_1', 'svg');
    await svc.save(key, Buffer.from('<svg/>'), 'image/svg+xml');
    await svc.remove(key);
    await expect(svc.read(key)).rejects.toBeDefined();
    // second remove on an already-gone key must not throw
    await expect(svc.remove(key)).resolves.toBeUndefined();
  });
});
