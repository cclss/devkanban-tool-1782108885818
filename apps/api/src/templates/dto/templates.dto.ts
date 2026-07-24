import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SignFieldDto } from '../../documents/dto/documents.dto';

/**
 * Create a reusable template: a stored PDF (by storage key) plus the saved
 * field layout. Reuses {@link SignFieldDto} so template placements validate
 * with the exact same normalized-geometry rules as a live contract's fields.
 */
export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** Storage key of the template's source PDF (prior presigned/local upload). */
  @IsString()
  @MaxLength(300)
  storageKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageCount?: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SignFieldDto)
  fields!: SignFieldDto[];
}

/** Rename a template — only the display name changes. */
export class RenameTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
