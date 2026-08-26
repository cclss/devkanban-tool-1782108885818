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
