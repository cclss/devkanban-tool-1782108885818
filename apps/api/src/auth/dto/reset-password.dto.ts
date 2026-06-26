import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import {
  IsFindIdTarget,
  normalizeTarget,
  type FindIdChannel,
} from './find-id.dto';

/**
 * Password-reset DTOs across the three-step flow.
 *
 * `request`/`verify` reuse the exact same channel/target shape as "find ID"
 * (`IsFindIdTarget` + `normalizeTarget`): `channel` selects how the user is
 * matched and where the code is delivered, and `@Transform` normalizes `target`
 * (lowercased email / canonical Korean mobile) before validation and the
 * service ever see it.
 *
 * `confirm` carries the high-entropy reset token plus the new password (and a
 * confirmation copy). The password rules mirror `RegisterDto` (`@MinLength(8)`,
 * `@MaxLength(72)` — bcrypt truncates past 72 bytes) so a password that could be
 * registered can also be set here.
 */
export type ResetPasswordChannel = FindIdChannel;

/** Assert that `target` equals the sibling string property named `property`. */
function MatchesProperty(property: string, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'matchesProperty',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [related] = args.constraints as [string];
          return value === (args.object as Record<string, unknown>)[related];
        },
        defaultMessage() {
          return '비밀번호가 일치하지 않아요. 다시 확인해 주세요.';
        },
      },
    });
  };
}

export class ResetPasswordRequestDto {
  @IsIn(['email', 'phone'])
  channel!: ResetPasswordChannel;

  @IsString()
  @MaxLength(254)
  @Transform(({ value, obj }) => normalizeTarget(value, obj.channel))
  @IsFindIdTarget()
  target!: string;
}

export class ResetPasswordVerifyDto {
  @IsIn(['email', 'phone'])
  channel!: ResetPasswordChannel;

  @IsString()
  @MaxLength(254)
  @Transform(({ value, obj }) => normalizeTarget(value, obj.channel))
  @IsFindIdTarget()
  target!: string;

  /** Exactly six digits. */
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResetPasswordConfirmDto {
  /** High-entropy reset token returned once by `verify` (plaintext, hashed server-side). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  /** New password — same bounds as `RegisterDto`. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  /** Must match `password`. */
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @MatchesProperty('password')
  passwordConfirm!: string;
}
