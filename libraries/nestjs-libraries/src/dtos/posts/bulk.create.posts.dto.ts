import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BulkCreatePostRowDto {
  @IsString()
  content!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  channels!: string[];

  @IsDateString()
  scheduleAt!: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;
}

export class BulkCreatePostsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkCreatePostRowDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  rows!: BulkCreatePostRowDto[];
}
