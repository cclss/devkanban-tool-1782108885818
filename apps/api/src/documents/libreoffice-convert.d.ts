/**
 * Minimal ambient types for `libreoffice-convert`, which ships no type
 * declarations. We use `convertWithOptions` so a custom `soffice` binary path
 * (from `LIBREOFFICE_BIN`) can be passed via `sofficeBinaryPaths` — the library
 * resolves the binary from a fixed list, not from `PATH`.
 */
declare module 'libreoffice-convert' {
  export interface ConvertOptions {
    /** Candidate `soffice` binary paths, tried before the built-in defaults. */
    sofficeBinaryPaths?: string[];
    sofficeAdditionalArgs?: string[];
    tmpOptions?: Record<string, unknown>;
  }

  export function convertWithOptions(
    input: Buffer,
    outputExtension: string,
    filter: string | undefined,
    options: ConvertOptions,
    callback: (err: Error | null, done: Buffer) => void,
  ): void;

  export function convert(
    input: Buffer,
    outputExtension: string,
    filter: string | undefined,
    callback: (err: Error | null, done: Buffer) => void,
  ): void;
}
