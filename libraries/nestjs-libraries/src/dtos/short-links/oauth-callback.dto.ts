import { IsString, IsUrl, MinLength } from 'class-validator';

export class OAuthCallbackDto {
  @IsString()
  code: string;

  @IsString()
  @MinLength(1)
  state: string;

  @IsString()
  @IsUrl({ require_tld: false }, { message: 'redirectUri must be a valid URL' })
  redirectUri: string;
}
