import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CopyCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  shiftDates?: boolean;

  @IsOptional()
  @IsBoolean()
  resetSchedule?: boolean;
}
