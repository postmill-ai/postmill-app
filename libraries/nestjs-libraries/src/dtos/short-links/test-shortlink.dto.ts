import { IsOptional, IsObject, IsString } from 'class-validator';

export class TestShortlinkDto {
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @IsOptional()
  @IsString()
  customDomain?: string;
}
