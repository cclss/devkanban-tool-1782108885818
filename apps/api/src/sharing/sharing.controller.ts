import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { SharingService } from './sharing.service';
import { CreateShareLinkDto } from './dto/sharing.dto';

/**
 * Sender-facing (JWT) share-link management for a document.
 *
 * Routed under the global `/api` prefix → `/api/documents/:id/share-links...`.
 * Every route is owner-scoped: the document must belong to the caller.
 */
@Controller('documents/:id/share-links')
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  /** Create a unique open/fill link (optional password + expiry). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') documentId: string,
    @Body() dto: CreateShareLinkDto,
    @Ip() ip: string,
  ) {
    return this.sharing.createLink(user.id, documentId, dto, ip);
  }

  /** List this document's share links with their derived status. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('id') documentId: string) {
    return this.sharing.listLinks(user.id, documentId);
  }

  /** Revoke a share link (idempotent). */
  @Post(':linkId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id') documentId: string,
    @Param('linkId') linkId: string,
    @Ip() ip: string,
  ) {
    return this.sharing.revokeLink(user.id, documentId, linkId, ip);
  }
}
