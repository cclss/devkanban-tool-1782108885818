import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { MESSAGES } from '../common/messages';
import type { GoogleAuthDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 10;

// The auth-code flow used by Google Identity Services in a browser SPA exchanges
// the code against this sentinel redirect URI (no server-rendered callback).
const GOOGLE_REDIRECT_URI = 'postmessage';

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; name: string | null; plan: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

  /**
   * Sign in (or sign up) with a Google account.
   *
   * Exchanges the SPA-supplied authorization `code` for tokens, independently
   * verifies the returned `id_token`'s signature and audience, then resolves the
   * user by `googleId` (preferred) or normalized email — creating a new account
   * or linking Google to an existing one. Returns the same `{ accessToken, user }`
   * contract as register/login.
   */
  async loginWithGoogle(dto: GoogleAuthDto): Promise<AuthResult> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      // Credentials not configured — fail safe without leaking the cause.
      throw new ServiceUnavailableException(MESSAGES.auth.googleUnavailable);
    }

    const client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri: GOOGLE_REDIRECT_URI,
    });

    // Exchange the auth code for tokens, then verify the id_token's signature
    // and `aud === GOOGLE_CLIENT_ID` via Google's public keys.
    let idToken: string | undefined;
    try {
      const { tokens } = await client.getToken(dto.code);
      idToken = tokens.id_token ?? undefined;
    } catch {
      throw new UnauthorizedException(MESSAGES.auth.googleAuthFailed);
    }
    if (!idToken) {
      throw new UnauthorizedException(MESSAGES.auth.googleAuthFailed);
    }

    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(MESSAGES.auth.googleAuthFailed);
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(MESSAGES.auth.googleAuthFailed);
    }
    if (!payload.email_verified) {
      throw new UnauthorizedException(MESSAGES.auth.googleEmailUnverified);
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase().trim();
    const name = payload.name ?? null;

    // Prefer matching the stable Google subject; fall back to email to link an
    // existing password account, otherwise create a social-only account.
    let user = await this.prisma.user.findUnique({ where: { googleId } });
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      user = byEmail
        ? await this.prisma.user.update({ where: { id: byEmail.id }, data: { googleId } })
        : await this.prisma.user.create({ data: { email, googleId, name } });
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
