import { IsDefined, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

export class AuthorizeOAuthQueryDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  @IsIn(['code'])
  response_type: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  @IsString()
  @IsOptional()
  @IsIn(['S256'])
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

export class ApproveOAuthDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsDefined()
  @IsIn(['approve', 'deny'])
  action: 'approve' | 'deny';

  @IsString()
  @IsOptional()
  @IsUrl({ require_tld: false })
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  @IsString()
  @IsOptional()
  @IsIn(['S256'])
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}
