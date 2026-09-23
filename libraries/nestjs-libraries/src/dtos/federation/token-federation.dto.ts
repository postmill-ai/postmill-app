import { IsDefined, IsOptional, IsString, IsUrl } from 'class-validator';

export class TokenFederationDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  @IsUrl({ require_tld: false })
  redirect_uri: string;

  @IsString()
  @IsOptional()
  code_verifier?: string;
}
