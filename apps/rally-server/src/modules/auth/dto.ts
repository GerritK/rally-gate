import { AccessRole } from '@rally-gate/shared';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RedeemDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  password: string;
}

/** `token` is the `?setup=` of the setup link the server logs. */
export class SetupDto extends SetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class CreateInvitationDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsEnum(AccessRole)
  role: AccessRole;

  /** Stage marshals only. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stageIds?: string[];
}

export class SetBlockedDto {
  @IsBoolean()
  blocked: boolean;
}
