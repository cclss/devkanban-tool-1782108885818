/**
 * Presentation-state resolver for `ImageUploader`.
 *
 * The uploader can show one of three states, and their precedence is the one bit
 * of logic worth pinning down away from JSX: a freshly picked file (with its live
 * blob preview) wins, then a stored asset URL, then the empty drop state. Keeping
 * it here — DOM-free, no React — means it runs in the `node` jest env and both the
 * component and its tests read the ordering from a single source.
 */

export type ImageUploaderView =
  /** A newly picked file is held; show its blob preview + filename/size meta. */
  | { kind: 'file'; previewUrl: string }
  /** No new pick, but a stored asset exists; show its URL as the thumbnail. */
  | { kind: 'saved'; url: string }
  /** Nothing selected and nothing stored; show the empty drop zone. */
  | { kind: 'empty' };

export interface ImageUploaderViewInput {
  /** Whether a valid `File` is currently held by the control. */
  hasFile: boolean;
  /** The object-URL derived from the held file, or `null` before it resolves. */
  previewUrl: string | null;
  /** The persisted asset URL, or `null`/`undefined` when none is stored. */
  currentUrl?: string | null;
}

/**
 * Pick the state to render. Newly picked file first, then the saved asset, then
 * empty — so selecting a file overrides the stored thumbnail, and clearing it
 * falls back to the stored asset (or empty when there is none).
 */
export function resolveImageUploaderView({
  hasFile,
  previewUrl,
  currentUrl,
}: ImageUploaderViewInput): ImageUploaderView {
  if (hasFile && previewUrl) return { kind: 'file', previewUrl };
  if (currentUrl) return { kind: 'saved', url: currentUrl };
  return { kind: 'empty' };
}
