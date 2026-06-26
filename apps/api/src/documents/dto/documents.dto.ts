import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Mirrors Prisma's SignFieldType enum (kept local to avoid a value import). */
export enum SignFieldTypeDto {
  SIGNATURE = 'SIGNATURE',
  DATE = 'DATE',
  TEXT = 'TEXT',
}

/** Mirrors Prisma's SignFieldSource enum (kept local to avoid a value import). */
export enum SignFieldSourceDto {
  AI = 'AI',
  MANUAL = 'MANUAL',
}

export class PresignDto {
  @IsString()
  @MaxLength(200)
  filename!: string;
}

export class CreateDocumentDto {
  /** Storage key returned by a prior presigned/local upload. */
  @IsString()
  @MaxLength(300)
  storageKey!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageCount?: number;
}

/**
 * A placed field. Geometry is normalized (0..1) relative to its page, with the
 * coordinate-system origin convention handled in the frontend grain.
 */
export class SignFieldDto {
  @IsEnum(SignFieldTypeDto)
  type!: SignFieldTypeDto;

  @IsInt()
  @Min(1)
  page!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  width!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  height!: number;

  /** 0-based recipient index this field is assigned to. */
  @IsOptional()
  @IsInt()
  @Min(0)
  recipientIndex?: number;

  /**
   * Provenance of the placement. `AI` = accepted straight from an AI suggestion;
   * `MANUAL` = hand-placed or an AI suggestion the user adjusted. Optional +
   * defaults to `MANUAL` server-side so older clients (which omit it) stay valid.
   */
  @IsOptional()
  @IsEnum(SignFieldSourceDto)
  source?: SignFieldSourceDto;

  /**
   * The suggestion model's internal confidence (0..1), kept only for AI-as-is
   * fields. Non-visual provenance metadata — never surfaced as a grade.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class SaveFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SignFieldDto)
  fields!: SignFieldDto[];
}

export class RecipientDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class SendContractDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients!: RecipientDto[];
}
