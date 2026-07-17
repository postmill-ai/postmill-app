import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class AddTeamMemberDto {
  @IsDefined()
  @IsEmail()
  @ValidateIf((o) => o.sendEmail)
  email: string;

  /** @deprecated Use roleId instead */
  @IsOptional()
  @IsString()
  @IsIn(['USER', 'ADMIN'])
  role?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsDefined()
  @IsBoolean()
  sendEmail: boolean;
}
