import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  /** Part of the file name, so a strict day rather than anything parseable. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}

export class OpenEventDto {
  @IsString()
  @IsNotEmpty()
  file: string;
}

/** The body is the file itself (`application/octet-stream`). */
export class ImportEventDto {
  /** The uploaded file's own name; only its cleaned last segment is used. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  file: string;

  @IsOptional()
  @IsIn(['true'])
  replace?: string;
}
