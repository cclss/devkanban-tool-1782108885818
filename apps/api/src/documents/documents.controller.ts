import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { MESSAGES } from '../common/messages';
import { attachmentDisposition } from '../common/http';
import { parseArtifactKind } from '../completion/artifact';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentDto,
  PresignDto,
  SaveFieldsDto,
  SendContractDto,
} from './dto/documents.dto';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  /** Primary upload path: multipart PDF → DRAFT document. */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ) {
    if (!file) {
      throw new BadRequestException(MESSAGES.document.emptyFile);
    }
    return this.documents.uploadAndCreate(user.id, file, ip);
  }

  /** Issue an upload target (S3 presigned PUT, or local fallback URL). */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  presign(@CurrentUser() user: AuthUser, @Body() dto: PresignDto) {
    return this.storage.createPresignedUpload(user.id, dto.filename);
  }

  /** Local-storage fallback target for the presigned flow (raw PDF bytes). */
  @Put('upload-local')
  @HttpCode(HttpStatus.OK)
  async uploadLocal(
    @CurrentUser() _user: AuthUser,
    @Query('key') key: string,
    @Req() req: Request,
  ) {
    if (!key) throw new BadRequestException(MESSAGES.document.emptyFile);
    const buffer = await collectRawBody(req, MAX_PDF_BYTES);
    if (buffer.length === 0) throw new BadRequestException(MESSAGES.document.emptyFile);
    await this.storage.save(key, buffer);
    return { storageKey: key, size: buffer.length };
  }

  /** Register a document after a presigned/local upload completed. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDto,
    @Ip() ip: string,
  ) {
    return this.documents.createFromStorageKey(user.id, dto, ip);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.documents.list(user.id);
  }

  @Get('quota')
  quota(@CurrentUser() user: AuthUser) {
    return this.documents.quota(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.detail(user.id, id);
  }

  /**
   * Download a completed contract's artifact (owner only).
   * `:artifact` is `signed` (최종 계약서) or `certificate` (감사 추적 인증서).
   */
  @Get(':id/download/:artifact')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('artifact') artifact: string,
    @Res() res: Response,
  ) {
    const kind = parseArtifactKind(artifact);
    if (!kind) throw new BadRequestException(MESSAGES.document.notFound);

    const { stream, filename } = await this.documents.openArtifact(user.id, id, kind);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    stream.pipe(res);
  }

  /** Replace placed sign fields on a draft. */
  @Put(':id/fields')
  saveFields(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveFieldsDto,
  ) {
    return this.documents.saveFields(user.id, id, dto);
  }

  /** Dispatch the contract → 진행 중. */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendContractDto,
    @Ip() ip: string,
  ) {
    return this.documents.send(user.id, id, dto, ip);
  }
}

/** Collect a raw request body stream into a size-bounded Buffer. */
function collectRawBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BadRequestException(MESSAGES.document.fileTooLarge));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}
