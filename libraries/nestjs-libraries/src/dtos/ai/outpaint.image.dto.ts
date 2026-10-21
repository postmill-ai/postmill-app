import { IsIn, IsOptional, IsString } from 'class-validator';
import { IsImageSource } from '@postmill-ai/nestjs-libraries/dtos/ai/image-source.validator';
import { OUTPAINT_MODES, type OutpaintMode } from '@postmill-ai/provider-kernel';

export class OutpaintImageDto {
  @IsString()
  @IsImageSource()
  imageUrl: string;

  // Canonical mode token (kernel `OutpaintMode`); the adapter maps it onto the
  // provider's vocabulary (flux-fill-pro's `outpaint` select).
  @IsIn(OUTPAINT_MODES)
  mode: OutpaintMode;

  @IsOptional()
  @IsString()
  prompt?: string;
}
