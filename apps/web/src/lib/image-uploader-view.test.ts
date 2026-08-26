/**
 * Unit tests for the ImageUploader's pure presentation logic.
 *
 * Runs in the `node` jest environment — no DOM. The three-state priority
 * (picked > saved > empty) and the object-URL revoke lifecycle are both
 * DOM-free: the resolver takes plain URLs, and the lifecycle takes a mock port
 * standing in for `URL.createObjectURL` / `URL.revokeObjectURL`.
 */

import {
  resolveImageUploaderView,
  createObjectUrlLifecycle,
  type ObjectUrlPort,
} from './image-uploader-view';

describe('resolveImageUploaderView — priority picked > saved > empty', () => {
  it('picks the local file when both picked and saved URLs are present', () => {
    expect(
      resolveImageUploaderView({ pickedUrl: 'blob:picked', savedUrl: 'https://cdn/saved.png' }),
    ).toEqual({ kind: 'picked', url: 'blob:picked' });
  });

  it('falls back to the saved asset when no file is picked', () => {
    expect(
      resolveImageUploaderView({ pickedUrl: null, savedUrl: 'https://cdn/saved.png' }),
    ).toEqual({ kind: 'saved', url: 'https://cdn/saved.png' });
  });

  it('falls back to the saved asset when picked is omitted entirely', () => {
    expect(resolveImageUploaderView({ savedUrl: 'https://cdn/saved.png' })).toEqual({
      kind: 'saved',
      url: 'https://cdn/saved.png',
    });
  });

  it('is empty when neither is present', () => {
    expect(resolveImageUploaderView({})).toEqual({ kind: 'empty' });
    expect(resolveImageUploaderView({ pickedUrl: null, savedUrl: null })).toEqual({
      kind: 'empty',
    });
  });

  it('treats blank / whitespace URLs as absent (not a picked/saved source)', () => {
    expect(resolveImageUploaderView({ pickedUrl: '', savedUrl: '  ' })).toEqual({ kind: 'empty' });
    expect(resolveImageUploaderView({ pickedUrl: '   ', savedUrl: 'https://cdn/s.png' })).toEqual({
      kind: 'saved',
      url: 'https://cdn/s.png',
    });
  });

  it('never reads File-specific fields — a URL alone resolves the saved state', () => {
    // Passing only a URL (no name/size) must still resolve; guards against the
    // saved path reaching into File.name / File.size.
    expect(resolveImageUploaderView({ savedUrl: 'https://cdn/only-a-url' }).kind).toBe('saved');
  });
});

describe('createObjectUrlLifecycle — revoke on replace and dispose', () => {
  /** A mock port recording every create/revoke, minting deterministic URLs. */
  function mockPort() {
    const created: string[] = [];
    const revoked: string[] = [];
    let seq = 0;
    const port: ObjectUrlPort = {
      create: () => {
        const url = `blob:${seq++}`;
        created.push(url);
        return url;
      },
      revoke: (url) => {
        revoked.push(url);
      },
    };
    return { port, created, revoked };
  }

  it('mints a URL for a source and returns it as current', () => {
    const { port, created } = mockPort();
    const life = createObjectUrlLifecycle(port);

    const url = life.set({});
    expect(url).toBe('blob:0');
    expect(life.current).toBe('blob:0');
    expect(created).toEqual(['blob:0']);
  });

  it('revokes the previous URL before minting the next on replace', () => {
    const { port, created, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({ file: 'a' });
    life.set({ file: 'b' }); // replace

    expect(created).toEqual(['blob:0', 'blob:1']);
    expect(revoked).toEqual(['blob:0']); // old one released exactly once
    expect(life.current).toBe('blob:1');
  });

  it('revokes and clears when the source is removed (set null)', () => {
    const { port, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({});
    const cleared = life.set(null);

    expect(cleared).toBeNull();
    expect(life.current).toBeNull();
    expect(revoked).toEqual(['blob:0']);
  });

  it('does not mint anything for a nullish source', () => {
    const { port, created, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    expect(life.set(null)).toBeNull();
    expect(created).toEqual([]);
    expect(revoked).toEqual([]);
  });

  it('revokes the live URL on dispose (unmount)', () => {
    const { port, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({});
    life.dispose();

    expect(revoked).toEqual(['blob:0']);
    expect(life.current).toBeNull();
  });

  it('dispose is idempotent and never double-revokes', () => {
    const { port, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({});
    life.dispose();
    life.dispose(); // second dispose is a no-op

    expect(revoked).toEqual(['blob:0']);
  });

  it('leaves nothing live across a full pick → replace → remove → dispose cycle', () => {
    const { port, created, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({ file: 'a' }); // pick
    life.set({ file: 'b' }); // replace
    life.set(null); // remove
    life.dispose(); // unmount

    // Every minted URL is revoked exactly once — no leak, no double-free.
    expect(revoked.sort()).toEqual([...created].sort());
    expect(life.current).toBeNull();
  });
});

describe('branding preview contract — lifecycle + resolver composed (usePickedUrl)', () => {
  /**
   * Models exactly what `BrandingPreview`'s `usePickedUrl` + `resolveImageUploaderView`
   * do together: a picked File drives an object-URL lifecycle, and the resolved
   * view is `pickedUrl` (guarded by "is a file held?") over the server `savedUrl`.
   * This pins the end-to-end real-time behavior — immediate reflect on pick,
   * revoke on replace/remove/unmount (leak = 0), and the picked > saved > empty
   * fallback the right panel renders — at the pure layer, no DOM/React needed.
   */
  function mockPort() {
    const created: string[] = [];
    const revoked: string[] = [];
    let seq = 0;
    const port: ObjectUrlPort = {
      create: () => {
        const url = `blob:${seq++}`;
        created.push(url);
        return url;
      },
      revoke: (url) => {
        revoked.push(url);
      },
    };
    return { port, created, revoked };
  }

  /** The exact resolver call the preview makes: guard the picked URL by file presence. */
  function view(file: unknown | null, pickedUrl: string | null, savedUrl: string | null) {
    return resolveImageUploaderView({ pickedUrl: file ? pickedUrl : null, savedUrl });
  }

  it('reflects a fresh pick immediately as picked, over any saved asset', () => {
    const { port, created } = mockPort();
    const life = createObjectUrlLifecycle(port);
    const saved = 'https://cdn/saved.png';

    const file = { name: 'logo.png' };
    const url = life.set(file); // pick → blob minted this frame
    expect(view(file, url, saved)).toEqual({ kind: 'picked', url: 'blob:0' });
    expect(created).toEqual(['blob:0']);
  });

  it('replacing the picked file revokes the old blob and shows the new one', () => {
    const { port, created, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);
    const saved = 'https://cdn/saved.png';

    const a = { name: 'a.png' };
    life.set(a);
    const b = { name: 'b.png' };
    const url = life.set(b); // replace

    expect(view(b, url, saved)).toEqual({ kind: 'picked', url: 'blob:1' });
    expect(revoked).toEqual(['blob:0']); // old preview freed, no leak
    expect(created).toEqual(['blob:0', 'blob:1']);
  });

  it('removing the pick reverts to the saved asset and revokes the blob', () => {
    const { port, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);
    const saved = 'https://cdn/saved.png';

    life.set({ name: 'a.png' });
    const cleared = life.set(null); // remove pick

    expect(view(null, cleared, saved)).toEqual({ kind: 'saved', url: saved });
    expect(revoked).toEqual(['blob:0']);
  });

  it('with no pick and no saved asset the preview is empty (wordmark/monogram fallback)', () => {
    const { port } = mockPort();
    const life = createObjectUrlLifecycle(port);

    expect(view(null, life.current, null)).toEqual({ kind: 'empty' });
  });

  it('a held file whose blob URL is not ready yet falls back to saved, never mis-renders as picked', () => {
    // usePickedUrl seeds `url` as null before its effect runs, so for one frame a
    // file can be held with no ready URL. The `file ? pickedUrl : null` guard plus
    // the resolver must yield `saved` (or empty), not a broken picked view.
    const saved = 'https://cdn/saved.png';
    expect(view({ name: 'logo.png' }, null, saved)).toEqual({ kind: 'saved', url: saved });
    expect(view({ name: 'logo.png' }, null, null)).toEqual({ kind: 'empty' });
  });

  it('unmount after a pick revokes the live blob — the preview leaks nothing', () => {
    const { port, created, revoked } = mockPort();
    const life = createObjectUrlLifecycle(port);

    life.set({ name: 'a.png' }); // pick
    life.dispose(); // unmount

    expect(revoked.sort()).toEqual([...created].sort());
    expect(life.current).toBeNull();
  });
});
