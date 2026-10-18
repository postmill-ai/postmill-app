import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDesignVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  /** Small JPEG data URL snapshot for the versions panel; optional. */
  @IsOptional()
  @IsString()
  previewDataUrl?: string;
}
