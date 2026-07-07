import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { promisify } from 'util';
import type { LibreOfficeConvert } from './document-conversion.service';

const logger = new Logger('LibreOfficeConvert');

/**
 * Build the real LibreOffice-backed converter bound to the `LIBREOFFICE_CONVERT`
 * token. `libreoffice-convert` resolves the `soffice` binary from a fixed list
 * of candidate paths (not from `PATH`), so when `LIBREOFFICE_BIN` points at a
 * non-default install (e.g. inside the API Docker image) we pass it through as
 * the first `sofficeBinaryPaths` candidate.
 *
 * The native module is imported lazily on the first conversion so the API can
 * boot in environments that never convert a document (soffice not yet present).
 */
export function createLibreOfficeConverter(config: ConfigService): LibreOfficeConvert {
  const sofficeBinaryPaths = resolveBinaryPaths(config.get<string>('LIBREOFFICE_BIN'));

  let convertWithOptions:
    | ((
        input: Buffer,
        ext: string,
        filter: string | undefined,
        options: { sofficeBinaryPaths?: string[] },
      ) => Promise<Buffer>)
    | undefined;

  return async (input: Buffer, outputExtension: string): Promise<Buffer> => {
    if (!convertWithOptions) {
      const libre = await import('libreoffice-convert');
      convertWithOptions = promisify(libre.convertWithOptions);
    }
    return convertWithOptions(input, outputExtension, undefined, { sofficeBinaryPaths });
  };
}

/** Custom soffice binary path from env, if it exists, else the built-in list. */
function resolveBinaryPaths(binPath?: string): string[] {
  if (!binPath) return []; // Fall back to libreoffice-convert's default paths.
  if (!existsSync(binPath)) {
    logger.warn(`LIBREOFFICE_BIN 경로에서 soffice를 찾을 수 없습니다: ${binPath}`);
    return [];
  }
  return [binPath];
}
