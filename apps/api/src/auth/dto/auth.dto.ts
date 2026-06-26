import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt truncates beyond 72 bytes.
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class GoogleAuthDto {
  // Authorization `code` from Google Identity Services (auth-code flow with
  // `redirect_uri: 'postmessage'`). Exchanged server-side for tokens.
  @IsString()
  @IsNotEmpty()
  code!: string;
}
