import { IsIn, IsOptional, IsString, Min, Max, IsNumber, IsBoolean, Length } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { METRIC_REGISTRY } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';

const KNOWN_METRICS = Object.keys(METRIC_REGISTRY);
const VALID_SORT_FIELDS = [...KNOWN_METRICS, 'publishedAt'];
const VALID_DIRECTIONS = ['asc', 'desc'] as const;

export class AnalyticsDateRangeDto {
  @IsString()
  from: string;

  @IsString()
  to: string;

  @IsOptional()
  @IsString()
  integrations?: string;

  @IsOptional()
  @IsString()
  compare?: string;

  // Comma-separated campaign uuid list (1.2). Each id is validated in the
  // controller's parseCampaigns helper. Inherited by AnalyticsPostsQueryDto and
  // AnalyticsExportQueryDto.
  @IsOptional()
  @IsString()
  campaigns?: string;
}

export class AnalyticsPostsQueryDto extends AnalyticsDateRangeDto {
  @IsOptional()
  @IsString()
  @IsIn(VALID_SORT_FIELDS, {
    message: `sort must be one of: ${VALID_SORT_FIELDS.join(', ')}`,
  })
  sort?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_DIRECTIONS, {
    message: 'dir must be asc or desc',
  })
  dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AnalyticsExportQueryDto extends AnalyticsDateRangeDto {
  @IsOptional()
  @IsString()
  @IsIn(['csv', 'json'], {
    message: 'format must be csv or json',
  })
  format?: string;
}

export class UpdateWatchlistDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
