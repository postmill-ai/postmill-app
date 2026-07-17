import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class RenderDesignDto {
  @IsObject()
  doc!: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  pageIndex?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  outputIndex?: number;

  @IsOptional()
  @IsIn(['png', 'pdf'])
  format?: 'png' | 'pdf';

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(4)
  pixelRatio?: number;

  @IsOptional()
  @IsBoolean()
  transparent?: boolean;
}
