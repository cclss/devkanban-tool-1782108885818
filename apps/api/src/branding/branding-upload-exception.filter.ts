import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { MESSAGES } from '../common/messages';

/** The Multer error shape we care about (avoids a direct multer import, which
 * isn't a hoisted dependency of this package under pnpm). */
interface MulterLikeError {
  name?: string;
  code?: string;
}

/**
 * Translate a Multer upload abort into Toss-tone copy.
 *
 * `FileInterceptor` enforces the 1MB `fileSize` limit by aborting the request
 * when it's exceeded. `@nestjs/platform-express` translates that Multer
 * `LIMIT_FILE_SIZE` abort into a `PayloadTooLargeException` (413) with a
 * generic English message; older setups may surface the raw MulterError
 * instead. Either way this filter rewrites it into the same "파일이 너무 커요…"
 * copy the client guard shows, so an over-limit upload is rejected with the
 * project's Toss-tone copy no matter where it's caught.
 *
 * Scoped to the branding upload routes only. Intentional `HttpException`s
 * (guard 401, DTO/validation 400, our own BadRequest) pass through unchanged.
 */
@Catch()
export class BrandingUploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      // Nest already mapped the Multer size-limit abort → 413. Rewrite it to the
      // format/size validation copy (as a 400, uniform with the other rejects).
      if (exception.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
        const mapped = new BadRequestException(MESSAGES.branding.fileTooLarge);
        res.status(mapped.getStatus()).json(mapped.getResponse());
        return;
      }
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const err = exception as MulterLikeError;
    if (err?.name === 'MulterError') {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? MESSAGES.branding.fileTooLarge
          : MESSAGES.branding.uploadFailed;
      const mapped = new BadRequestException(message);
      res.status(mapped.getStatus()).json(mapped.getResponse());
      return;
    }

    // Anything else is unexpected — a safe 500 without leaking internals.
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
