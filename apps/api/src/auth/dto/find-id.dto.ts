import { Transform } from 'class-transformer';
import {
  isEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { KOREAN_MOBILE_REGEX, normalizeKoreanMobile } from '../../common/phone';

/**
 * "Find ID" identity-verification DTOs.
 *
 * `channel` selects how the user is matched and where the code is delivered:
 *   - 'email' → `target` must be a valid email (normalized to lowercase).
 *   - 'phone' → `target` is normalized to canonical Korean mobile digits and
 *               must match {@link KOREAN_MOBILE_REGEX}.
 *
 * `class-validator`'s `@ValidateIf` is per-property (a false condition skips
 * every rule on the property), so channel-conditional format checks are
 * expressed with one custom `@IsFindIdTarget` constraint. The `@Transform` runs
 * first, so both validation and the service see the normalized value.
 */
export type FindIdChannel = 'email' | 'phone';

/** Normalize `target` based on the sibling `channel` value. */
function normalizeTarget(value: unknown, channel: unknown): unknown {
  if (typeof value !== 'string') return value;
  return channel === 'phone'
    ? normalizeKoreanMobile(value)
    : value.trim().toLowerCase();
}

/** Validate `target` as an email or Korean mobile, picked by sibling `channel`. */
function IsFindIdTarget(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFindIdTarget',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const channel = (args.object as { channel?: unknown }).channel;
          if (channel === 'email') return isEmail(value);
          if (channel === 'phone') return KOREAN_MOBILE_REGEX.test(value);
          return false;
        },
        defaultMessage() {
          return '이메일 주소 또는 휴대폰 번호를 정확히 입력해 주세요.';
        },
      },
    });
  };
}

export class FindIdRequestDto {
  @IsIn(['email', 'phone'])
  channel!: FindIdChannel;

  @IsString()
  @MaxLength(254)
  @Transform(({ value, obj }) => normalizeTarget(value, obj.channel))
  @IsFindIdTarget()
  target!: string;
}

export class FindIdVerifyDto {
  @IsIn(['email', 'phone'])
  channel!: FindIdChannel;

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
