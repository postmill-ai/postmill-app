import { IsString, IsUrl } from 'class-validator';

export class OAuthUrlDto {
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'redirectUri must be a valid URL' })
  redirectUri: string;
}
