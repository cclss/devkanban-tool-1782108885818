/**
 * Presentation logic for the branding ImageUploader — DOM-free and pure.
 *
 * Two concerns live here so both are unit-testable without a DOM (the web app's
 * jest runs in the `node` environment), and so the component stays a thin shell
 * over decisions it does not have to make inline:
 *
 *   1. `resolveImageUploaderView` — the three-state source-of-truth priority a
 *      branding image control renders: a newly **picked** local file wins, then
 *      the **saved** server asset, then the **empty** drop-zone. This is the
 *      picked > saved > empty rule the settings preview rests on.
 *   2. `createObjectUrlLifecycle` — the blob bookkeeping that guarantees every
 *      local object URL is revoked when the file is replaced and when the owner
 *      is disposed (unmount), so preview blobs never leak. The DOM
 *      `URL.createObjectURL` / `URL.revokeObjectURL` calls are injected as a
 *      port, keeping the lifecycle logic itself pure and testable.
 *
 * No network, no React, no `File`-specific fields — a saved asset renders from a
 * URL alone, so this module never reaches into `File.name` / `File.size`.
 */

/**
 * Which source the uploader should render, tagged with the URL to show. The
 * `empty` case carries no URL — the caller renders the default drop zone.
 */
export type ImageUploaderView =
  | { kind: 'picked'; url: string }
  | { kind: 'saved'; url: string }
  | { kind: 'empty' };

/** Inputs to the three-state resolution — both URLs are optional/absent. */
export interface ImageUploaderViewInput {
  /**
   * Object URL of the locally picked file, or `null`/absent when no file is
   * held (or its preview URL is not ready yet). A blank string counts as absent.
   */
  pickedUrl?: string | null;
  /**
   * URL of the asset already saved on the server, or `null`/absent when none is
   * stored. A blank string counts as absent.
   */
  savedUrl?: string | null;
}

/** Treat `null`, `undefined`, and empty/whitespace strings all as "no URL". */
function presentUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.trim() !== '';
}

/**
 * Resolve the uploader's render source by the fixed priority
 * **picked > saved > empty**. A locally picked file always wins over the saved
 * asset (removing the pick falls back to saved; with neither, to empty).
 */
export function resolveImageUploaderView(input: ImageUploaderViewInput): ImageUploaderView {
  if (presentUrl(input.pickedUrl)) return { kind: 'picked', url: input.pickedUrl };
  if (presentUrl(input.savedUrl)) return { kind: 'saved', url: input.savedUrl };
  return { kind: 'empty' };
}

/** Port over the DOM object-URL API, injected so the lifecycle stays pure. */
export interface ObjectUrlPort {
  /** Mint an object URL for the given blob/file source. */
  create(source: unknown): string;
  /** Release a previously minted object URL. */
  revoke(url: string): void;
}

/**
 * The mutable half of the object-URL lifecycle: at most one live URL at a time.
 * `set` revokes the previous URL before minting the next (so replacing a file
 * never leaks the old blob); `dispose` revokes the final URL (unmount).
 */
export interface ObjectUrlLifecycle {
  /**
   * Point the lifecycle at a new source. Revokes the current URL (if any), then
   * mints and returns a URL for `source`, or `null` when `source` is nullish.
   */
  set(source: unknown | null): string | null;
  /** Revoke the current URL (if any) and clear it. Idempotent. */
  dispose(): void;
  /** The live URL, or `null` when nothing is held. */
  readonly current: string | null;
}

/**
 * Build an object-URL lifecycle over the given port. Keeping the create/revoke
 * side of the DOM behind a port lets the "revoke on replace, revoke on dispose"
 * guarantee be verified in a plain node test with a mock port.
 */
export function createObjectUrlLifecycle(port: ObjectUrlPort): ObjectUrlLifecycle {
  let current: string | null = null;

  function revokeCurrent(): void {
    if (current !== null) {
      port.revoke(current);
      current = null;
    }
  }

  return {
    set(source: unknown | null): string | null {
      revokeCurrent();
      if (source != null) {
        current = port.create(source);
      }
      return current;
    },
    dispose(): void {
      revokeCurrent();
    },
    get current(): string | null {
      return current;
    },
  };
}
