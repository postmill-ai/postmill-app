import {
  IsDefined,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateTeamUserDto {
  @IsDefined()
  @IsEmail()
  email!: string;

  @IsDefined()
  @IsString()
  @MinLength(6)
  password!: string;

  /** @deprecated Use roleId instead */
  @IsOptional()
  @IsString()
  @IsIn(['USER', 'ADMIN'])
  role: 'USER' | 'ADMIN' = 'USER';

  @IsOptional()
  @IsString()
  roleId?: string;
}
