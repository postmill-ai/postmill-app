import { IsBoolean, IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Provider } from '@prisma/client';

export class UpsertAuthProviderDto {
  @IsString()
  @IsDefined()
  provider: Provider;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  clientId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  clientSecret: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  authUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  tokenUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  userInfoUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  scopes: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  displayName: string;

  @IsOptional()
  @IsBoolean()
  enabled: boolean;
}
