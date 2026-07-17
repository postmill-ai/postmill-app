import {
  IsObject,
  IsString,
  IsNumber,
  IsOptional,
} from 'class-validator';

export class UpdateDesignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  doc?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsString()
  previewDataUrl?: string;

  @IsOptional()
  @IsString()
  previewFileId?: string;
}
