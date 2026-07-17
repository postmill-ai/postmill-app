import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Validated query parameters for GET /auth/oauth/:provider.
 *
 * These values are passed through to the provider's `generateLink` implementation.
 * Only known, bounded string parameters are allowed; anything else is rejected
 * by the global whitelist pipe.
 */
export class OAuthLinkQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  publicKey?: string;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  login_hint?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  scope?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  callback?: string;
}
