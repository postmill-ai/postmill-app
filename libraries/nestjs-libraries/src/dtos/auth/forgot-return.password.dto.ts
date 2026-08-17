import { IsDefined, IsString, MinLength } from 'class-validator';
import { MatchesProperty } from '@postmill-ai/nestjs-libraries/dtos/auth/matches.property.validator';

export class ForgotReturnPasswordDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  password: string;

  @IsString()
  @IsDefined()
  @MatchesProperty('password', {
    message: 'Passwords do not match',
  })
  repeatPassword: string;

  @IsString()
  @IsDefined()
  @MinLength(5)
  token: string;
}
