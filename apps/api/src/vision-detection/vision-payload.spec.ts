import { buildVisionRequestBody } from './vision-payload';
import type { VisionAnalysisInput } from './vision-detection.types';

describe('buildVisionRequestBody (PII boundary)', () => {
  const input: VisionAnalysisInput = {
    pages: [
      {
        page: 1,
        width: 595,
        height: 842,
        mimeType: 'image/png',
        image: Buffer.from('page-1-pixels'),
      },
      {
        page: 2,
        width: 595,
        height: 842,
        mimeType: 'image/jpeg',
        image: Buffer.from('page-2-pixels'),
      },
    ],
  };

  it('serializes only page pixels + geometry (image as base64)', () => {
    const body = buildVisionRequestBody(input);

    expect(body.pages).toHaveLength(2);
    expect(body.pages[0]).toEqual({
      page: 1,
      width: 595,
      height: 842,
      mimeType: 'image/png',
      image: Buffer.from('page-1-pixels').toString('base64'),
    });
    // Each wire page carries EXACTLY the allowlisted keys — nothing more.
    expect(Object.keys(body.pages[0]).sort()).toEqual([
      'height',
      'image',
      'mimeType',
      'page',
      'width',
    ]);
  });

  it('drops stray/PII properties attached to input pages (no leak onto the wire)', () => {
    // Simulate identifying metadata accidentally riding along on a page object.
    const leaky = {
      ...input.pages[0],
      ownerEmail: 'user@example.com',
      ownerId: 'usr_123',
      sourceFilename: '2024-계약서-홍길동.pdf',
      documentTitle: '비밀 계약',
    };
    const body = buildVisionRequestBody({ pages: [leaky] });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('user@example.com');
    expect(serialized).not.toContain('usr_123');
    expect(serialized).not.toContain('홍길동');
    expect(serialized).not.toContain('비밀 계약');
    expect(Object.keys(body.pages[0]).sort()).toEqual([
      'height',
      'image',
      'mimeType',
      'page',
      'width',
    ]);
  });

  it('tolerates an empty document', () => {
    expect(buildVisionRequestBody({ pages: [] })).toEqual({ pages: [] });
  });
});
