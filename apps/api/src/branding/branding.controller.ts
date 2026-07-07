import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MESSAGES } from '../common/messages';
import { BrandingService } from './branding.service';
import { BrandingUploadExceptionFilter } from './branding-upload-exception.filter';
import { UpdateBrandingDto } from './dto/branding.dto';
import { MAX_IMAGE_BYTES, parseAssetKind } from './image-validation';

@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Upload the service logo (authenticated, multipart, ≤1MB SVG/PNG). */
  @Post('logo')
  @UseGuards(JwtAuthGuard)
  @UseFilters(BrandingUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.branding.saveAsset('logo', file);
  }

  /** Upload the browser-tab favicon (authenticated, multipart, ≤1MB SVG/PNG). */
  @Post('favicon')
  @UseGuards(JwtAuthGuard)
  @UseFilters(BrandingUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  uploadFavicon(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.branding.saveAsset('favicon', file);
  }

  /** Set the primary brand color (authenticated, hex validated by the DTO). */
  @Patch()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  updateColor(@Body() dto: UpdateBrandingDto) {
    return this.branding.updateColor(dto.brandColor);
  }

  /** Public: current branding (color + serving URLs for stored assets). */
  @Get()
  get() {
    return this.branding.get();
  }

  /**
   * Public: stream a stored asset's bytes with its saved Content-Type and a
   * cache header. `:kind` is `logo` or `favicon`.
   */
  @Get('asset/:kind')
  async asset(@Param('kind') kind: string, @Res() res: Response) {
    const parsed = parseAssetKind(kind);
    if (!parsed) throw new NotFoundException(MESSAGES.branding.assetNotFound);

    const { stream, contentType } = await this.branding.openAsset(parsed);
    res.setHeader('Content-Type', contentType);
    // Serving path is stable per kind; GET /branding hands out a versioned URL
    // (`?v=…`) that changes on replacement, so a short public cache is safe and
    // still reflects new uploads immediately via the fresh URL.
    res.setHeader('Cache-Control', 'public, max-age=300');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }
}
