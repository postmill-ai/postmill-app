import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';

export class LoginUserDto {
  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  @MinLength(3)
  password: string;

  @IsString()
  @IsDefined()
  provider: Provider;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.password)
  providerToken: string;

  @IsEmail()
  @IsDefined()
  email: string;

  // Optional analytics cookie sent by the frontend; must be declared so the global
  // forbidNonWhitelisted pipe (3Y) doesn't 400 the request.
  @IsOptional()
  @IsString()
  datafast_visitor_id: string;
}
