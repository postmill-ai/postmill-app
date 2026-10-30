import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
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
   * Output resolution as a multiple of the canvas size. Absent = render at
   * canvas size. Applied to the Chromium viewport and frame canvas, not as a
   * post-scale, so >1 is a true supersample. The shorthand buttons (0.5×/1×/2×)
   * and the 720p/1080p/4K + platform presets all resolve to a multiplier in
   * this range.
   */
  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(4)
  scale?: number;

  /** Frame-rate override (24/30/60). Absent = the composition's own fps. */
  @IsOptional()
  @IsInt()
  @IsIn([24, 30, 60])
  fps?: number;

  /** Normalize the final audio mix to -14 LUFS / -1.5 dBTP (ffmpeg loudnorm). */
  @IsOptional()
  @IsBoolean()
  normalizeLoudness?: boolean;

  @IsOptional()
  @IsString()
  posterUrl?: string;

  /** Timeline timestamp for the generated poster. Absent = the existing midpoint. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180000)
  posterTimeMs?: number;

  @IsOptional()
  @IsString()
  folderId?: string;
}

export class RenderVideoStatusDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  artifactUrl?: string | null;

  @ApiPropertyOptional()
  fileId?: string;

  @ApiProperty()
  alt!: string;

  @ApiPropertyOptional()
  thumbnailUrl?: string;

  @ApiPropertyOptional()
  generatedPosterUrl?: string;

  @ApiProperty()
  thumbnailTimestamp!: number;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  progress!: number;
}
