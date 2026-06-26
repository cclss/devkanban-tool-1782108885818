import {
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
import { CurrentShare } from './current-share.decorator';
import { ShareSessionGuard } from './share-session.guard';
import type { ShareSession } from './share-session.service';
import { SharingService } from './sharing.service';
import { UnlockShareLinkDto } from './dto/sharing.dto';
import { SaveFieldValuesDto } from '../signing/dto/signing.dto';

/**
 * Public (JWT-free) share-link endpoints keyed by the LINK SignRequest token.
 *
 * Routed under the global `/api` prefix → `/api/share/:token/...`. The
 * session-guarded routes additionally require a short-lived share token issued
 * by `/unlock`. Expiry/revocation is enforced on every path.
 */
@Controller('share')
export class SharePublicController {
  constructor(private readonly sharing: SharingService) {}

  /** ① Pre-auth minimal metadata (no PDF / fields). */
  @Get(':token')
  meta(@Param('token') token: string) {
    return this.sharing.meta(token);
  }

  /** ② Unlock (verify password if set) → short-lived share session token. */
  @Post(':token/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @Param('token') token: string,
    @Body() dto: UnlockShareLinkDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.sharing.unlock(token, dto.password, ip, userAgent);
  }

  /** ③ Recipient's fields + short-lived PDF path (session required). */
  @Get(':token/payload')
  @UseGuards(ShareSessionGuard)
  payload(@Param('token') token: string, @CurrentShare() share: ShareSession) {
    return this.sharing.payload(share.signRequestId, token);
  }

  /** ④ Stream the document PDF bytes (session required). */
  @Get(':token/pdf')
  @UseGuards(ShareSessionGuard)
  async pdf(@CurrentShare() share: ShareSession, @Res() res: Response) {
    const stream = await this.sharing.openPdf(share.signRequestId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }

  /** ⑤ Persist captured field values (session required). */
  @Post(':token/fields')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShareSessionGuard)
  saveFields(@CurrentShare() share: ShareSession, @Body() dto: SaveFieldValuesDto) {
    return this.sharing.saveFields(share.signRequestId, dto);
  }

  /** ⑥ Finalize the recipient's submission (session required). */
  @Post(':token/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ShareSessionGuard)
  submit(
    @CurrentShare() share: ShareSession,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.sharing.submit(share.signRequestId, ip, userAgent);
  }
}
