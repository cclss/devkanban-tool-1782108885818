import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { MESSAGES } from '../common/messages';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/branding.dto';
import { LOGO_UPLOAD_CEILING_BYTES } from './logo';

/**
 * Sender-facing branding settings (admin "회사 설정 → 브랜딩"), plus the PUBLIC
 * logo serving route.
 *
 * Guards are applied per-route, not on the class: every write/read of the
 * sender's own settings requires a JWT, but `GET :userId/logo` is deliberately
 * unauthenticated so external signers can render the logo before they verify.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Current color/font/logo + plan eligibility. */
  @Get()
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthUser) {
    return this.branding.get(user.id);
  }

  /** Save brand color/font. Logo upload is handled separately. */
  @Put()
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.update(user.id, dto);
  }

  /** Upload (or replace) the brand logo. JPG/PNG/SVG only; plan-gated. */
  @Post('logo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_UPLOAD_CEILING_BYTES } }),
  )
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(MESSAGES.branding.logoEmpty);
    return this.branding.uploadLogo(user.id, file);
  }

  /** Remove the brand logo. Plan-gated. */
  @Delete('logo')
  @UseGuards(JwtAuthGuard)
  deleteLogo(@CurrentUser() user: AuthUser) {
    return this.branding.removeLogo(user.id);
  }

  /**
   * PUBLIC: serve a user's brand logo to (unauthenticated) signers and email
   * clients. Correct Content-Type + a cacheable response; SVGs additionally get
   * `Content-Security-Policy: sandbox` and an inline disposition so a direct
   * navigation can't execute any (already-sanitized) inline script.
   */
  @Get(':userId/logo')
  async serveLogo(@Param('userId') userId: string, @Res() res: Response): Promise<void> {
    const { buffer, contentType, isSvg } = await this.branding.serveLogo(userId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isSvg) {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('Content-Disposition', 'inline');
    }
    res.send(buffer);
  }
}
