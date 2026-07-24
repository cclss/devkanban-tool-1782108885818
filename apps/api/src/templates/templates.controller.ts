import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, RenameTemplateDto } from './dto/templates.dto';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** Save a new reusable template (PDF key + field layout). */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user.id, dto);
  }

  /** List the signed-in owner's templates, newest first. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.id);
  }

  /** Load a single template incl. its field layout. */
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.detail(user.id, id);
  }

  /** Stream the template's original PDF bytes inline (owner only). */
  @Get(':id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const stream = await this.templates.openPdf(user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="template.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }

  /** Rename a template. */
  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameTemplateDto,
  ) {
    return this.templates.rename(user.id, id, dto);
  }

  /** Delete a template. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.remove(user.id, id);
  }
}
