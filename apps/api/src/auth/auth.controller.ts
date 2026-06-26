import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FindIdService } from './find-id.service';
import { GoogleAuthDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { FindIdRequestDto, FindIdVerifyDto } from './dto/find-id.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly findId: FindIdService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() dto: GoogleAuthDto) {
    return this.auth.loginWithGoogle(dto);
  }

  // --- 아이디 찾기(계정 복구) ----------------------------------------------

  @Post('find-id/request')
  @HttpCode(HttpStatus.OK)
  findIdRequest(@Body() dto: FindIdRequestDto) {
    return this.findId.request(dto);
  }

  @Post('find-id/verify')
  @HttpCode(HttpStatus.OK)
  findIdVerify(@Body() dto: FindIdVerifyDto) {
    return this.findId.verify(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, plan: true, brandColor: true, brandLogoUrl: true },
    });
    return record;
  }
}
