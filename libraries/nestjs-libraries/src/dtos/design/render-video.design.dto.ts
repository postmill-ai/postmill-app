import {
  IsIn,
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

  /**
   * Output resolution as a multiple of the canvas size (0.5×/1×/2×). Absent =
   * render at canvas size. Applied to the Chromium viewport and frame canvas,
   * not as a post-scale, so 2× is a true supersample.
   */
  @IsOptional()
  @IsNumber()
  @IsIn([0.5, 1, 2])
  scale?: number;

  /** Frame-rate override (24/30/60). Absent = the composition's own fps. */
  @IsOptional()
  @IsInt()
  @IsIn([24, 30, 60])
  fps?: number;

  @IsOptional()
  @IsString()
  posterUrl?: string;

  @IsOptional()
  @IsString()
  folderId?: string;
}
