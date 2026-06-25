import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Upper bound for a captured field value (signature dataURL can be large). */
export const FIELD_VALUE_MAX_LENGTH = 5_000_000;

export class VerifyCodeDto {
  /** 6-digit numeric verification code delivered out of band. */
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

/** A single captured field value (signature dataURL / text / date string). */
export class FieldValueDto {
  @IsString()
  @MaxLength(64)
  fieldId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(FIELD_VALUE_MAX_LENGTH)
  value!: string;
}

export class SaveFieldValuesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FieldValueDto)
  fields!: FieldValueDto[];
}
