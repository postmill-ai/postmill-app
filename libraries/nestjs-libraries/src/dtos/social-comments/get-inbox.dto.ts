import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class GetInboxDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  integrationId?: string;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  limit?: number;
}
