import {
  IsObject,
  IsString,
  IsOptional,
} from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsObject()
  doc?: Record<string, any>;

  @IsOptional()
  @IsString()
  thumbnailFileId?: string;
}
