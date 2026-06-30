import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/branding.dto';

/** Sender-facing branding settings (admin "회사 설정 → 브랜딩"). */
@Controller('branding')
@UseGuards(JwtAuthGuard)
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  /** Current color/font/logo + plan eligibility. */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.branding.get(user.id);
  }

  /** Save brand color/font. Logo upload is handled separately. */
  @Put()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.update(user.id, dto);
  }
}
