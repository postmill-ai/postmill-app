import { IsDefined, IsOptional, IsString, IsUrl } from 'class-validator';

export class TokenExchangeDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  client_secret: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_verifier?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}
