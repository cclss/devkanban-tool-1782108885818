import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../common/messages';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; name: string | null; plan: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(MESSAGES.auth.emailTaken);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: dto.name ?? null },
    });

    return this.buildResult(user.id, user.email, user.name, user.plan);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a hash comparison to keep timing roughly constant whether or
    // not the email exists; never reveal which half was wrong.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(dto.password, hash);
    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException(MESSAGES.auth.invalidCredentials);
    }

    return this.buildResult(user.id, user.email, user.name, user.plan);
  }

  private buildResult(
    id: string,
    email: string,
    name: string | null,
    plan: string,
  ): AuthResult {
    const accessToken = this.jwt.sign({ sub: id, email });
    return { accessToken, user: { id, email, name, plan } };
  }
}
