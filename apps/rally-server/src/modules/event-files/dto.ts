import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

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
