import { IsIn, IsOptional, IsString } from 'class-validator';

export class BillingSubscribeDto {
  @IsIn(['MONTHLY', 'YEARLY'])
  period: 'MONTHLY' | 'YEARLY';

  @IsIn(['STARTER', 'PRO', 'TEAM', 'AGENCY'])
  billing: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';

  // Optional analytics/attribution fields the frontend always sends (utm string from
  // useUtmUrl, dub click id, datafast cookies). Declare them so the global
  // forbidNonWhitelisted pipe doesn't 400 the subscribe request.
  @IsOptional()
  @IsString()
  utm: string;

  @IsOptional()
  @IsString()
  dub: string;

  @IsOptional()
  @IsString()
  datafast_session_id: string;

  @IsOptional()
  @IsString()
  datafast_visitor_id: string;
}
