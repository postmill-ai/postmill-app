import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Provider } from '@prisma/client';

export class CreateOrgUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
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
  @ValidateIf((o) => !o.providerToken)
  email: string;

  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(128)
  company: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  lastName: string;

  // Optional analytics cookie sent by the frontend; must be declared so the global
  // forbidNonWhitelisted pipe (3Y) doesn't 400 the request.
  @IsOptional()
  @IsString()
  datafast_visitor_id: string;
}
