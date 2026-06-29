import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
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
import { StorageService } from '../storage/storage.service';
import { BrandingService } from './branding.service';
import { BrandingGuard } from './branding.guard';
import { MAX_LOGO_BYTES } from './branding.validation';
import { UpdateBrandingDto } from './dto/branding.dto';

@Controller('branding')
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly storage: StorageService,
  ) {}

  /** Current branding (color/font/logo) + plan entitlement. Team+ only. */
  @Get()
  @UseGuards(JwtAuthGuard, BrandingGuard)
  get(@CurrentUser() user: AuthUser) {
    return this.branding.getBranding(user.id);
  }

  /** Update brand color and/or font (validated). Team+ only. */
  @Put()
  @UseGuards(JwtAuthGuard, BrandingGuard)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.updateBranding(user.id, dto);
  }

  /** Upload a brand logo (multipart `file`; JPG/PNG/SVG only). Team+ only. */
  @Post('logo')
  @UseGuards(JwtAuthGuard, BrandingGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }),
  )
  uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException(MESSAGES.branding.logoEmpty);
    }
    return this.branding.uploadLogo(user.id, file);
  }

  /** Remove the current brand logo. Idempotent. Team+ only. */
  @Delete('logo')
  @UseGuards(JwtAuthGuard, BrandingGuard)
  @HttpCode(HttpStatus.OK)
  deleteLogo(@CurrentUser() user: AuthUser) {
    return this.branding.deleteLogo(user.id);
  }

  /**
   * Serve raw logo bytes for a `branding/` key.
   *
   * Intentionally unauthenticated: the signer-facing screen (later grain) loads
   * this URL for external recipients who have no session. Access is bounded to
   * the `branding/` namespace (unguessable UUID keys), and `nosniff` plus the
   * stored content type keep an SVG from being reinterpreted.
   */
  @Get('logo/file')
  async serveLogo(@Query('key') key: string, @Res() res: Response): Promise<void> {
    const safeKey = this.branding.resolveLogoKey(key);
    let stream;
    try {
      stream = await this.storage.openStream(safeKey);
    } catch {
      res.status(HttpStatus.NOT_FOUND).json({ message: MESSAGES.branding.logoNotFound });
      return;
    }
    res.setHeader('Content-Type', this.storage.contentTypeForKey(safeKey));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }
}
