import { IsString } from 'class-validator';

/** The key comes from the path; only the value is in the body. */
export class SetSettingDto {
  // Not @IsNotEmpty: settings are free-form strings and "" is a legitimate
  // value to store. Only the type is constrained.
  @IsString()
  value: string;
}
