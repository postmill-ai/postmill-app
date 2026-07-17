import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class RenderVideoDesignDto {
  @IsObject()
  composition!: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  outputIndex?: number;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsNumber()
  quality?: number;

  @IsOptional()
  @IsNumber()
  bitrateKbps?: number;

  @IsOptional()
  @IsString()
  posterUrl?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}
