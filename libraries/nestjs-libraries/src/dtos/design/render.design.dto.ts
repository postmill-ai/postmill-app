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

  /**
   * Page WITHIN the output (doc v8): 0 is page 1 (`output.children`),
   * n ≥ 1 renders `output.pages[n - 1]`. Distinct from `pageIndex`, which is
   * the legacy alias for `outputIndex` and keeps working unchanged.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  pageNumber?: number;

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
