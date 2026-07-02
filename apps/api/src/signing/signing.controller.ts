import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MESSAGES } from '../common/messages';
import { attachmentDisposition } from '../common/http';
import { parseArtifactKind } from '../completion/artifact';
import { CurrentSigner } from './current-signer.decorator';
import { SignerSessionGuard } from './signer-session.guard';
import type { SignerSession } from './signer-session.service';
import { SigningService } from './signing.service';
import { SaveFieldValuesDto, VerifyCodeDto } from './dto/signing.dto';

/**
 * Public (JWT-free) signing endpoints keyed by SignRequest.accessToken.
 *
 * Routed under the global `/api` prefix → `/api/signing/:token/...`.
 * `:token` is the SignRequest access token embedded in the signing link.
 * The session-guarded routes additionally require a short-lived signer token.
 */
@Controller('signing')
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  /** ① Pre-auth minimal metadata (no PDF / fields). */
  @Get(':token')
  meta(@Param('token') token: string) {
    return this.signing.meta(token);
  }

  /** ② Verify the 6-digit code → issue a short-lived signer session token. */
  @Post(':token/verify')
  @HttpCode(HttpStatus.OK)
  verify(
    @Param('token') token: string,
    @Body() dto: VerifyCodeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.signing.verify(token, dto.code, ip, userAgent);
  }

  /** ③ Signer's fields + short-lived PDF path (session required). */
  @Get(':token/payload')
  @UseGuards(SignerSessionGuard)
  payload(@CurrentSigner() signer: SignerSession) {
    return this.signing.payload(signer.signRequestId);
  }

  /** ④ Stream the document PDF bytes (session required). */
  @Get(':token/pdf')
  @UseGuards(SignerSessionGuard)
  async pdf(@CurrentSigner() signer: SignerSession, @Res() res: Response) {
    const stream = await this.signing.openPdf(signer.signRequestId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }

  /**
   * ⑧ Cached AI clause cards for the signer (session required).
   * Auxiliary reminder channel — does NOT replace source access (`:token/pdf`).
   * READY → card array; EMPTY/FAILED/PENDING → empty array (front-end falls back
   * to the full-PDF view). Served from cache; never generated on link-open.
   */
  @Get(':token/clauses')
  @UseGuards(SignerSessionGuard)
  clauses(@CurrentSigner() signer: SignerSession) {
    return this.signing.clauses(signer.signRequestId);
  }

  /** ⑤ Persist captured field values (session required). */
  @Post(':token/fields')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SignerSessionGuard)
  saveFields(
    @CurrentSigner() signer: SignerSession,
    @Body() dto: SaveFieldValuesDto,
  ) {
    return this.signing.saveFields(signer.signRequestId, dto);
  }

  /**
   * ⑦ Download a completed contract's artifact (session required).
   * `:artifact` is `signed` (최종 계약서) or `certificate` (감사 추적 인증서).
   * Only resolves once the document is COMPLETED and the artifacts are stored.
   */
  @Get(':token/download/:artifact')
  @UseGuards(SignerSessionGuard)
  async download(
    @CurrentSigner() signer: SignerSession,
    @Param('artifact') artifact: string,
    @Res() res: Response,
  ) {
    const kind = parseArtifactKind(artifact);
    if (!kind) throw new BadRequestException(MESSAGES.signing.invalidLink);

    const { stream, filename } = await this.signing.openArtifact(signer.signRequestId, kind);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }

  /** ⑥ Finalize the signer's part (session required). */
  @Post(':token/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SignerSessionGuard)
  complete(
    @CurrentSigner() signer: SignerSession,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.signing.complete(signer.signRequestId, ip, userAgent);
  }
}
