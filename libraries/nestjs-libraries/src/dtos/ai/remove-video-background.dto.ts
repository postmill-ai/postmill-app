import { IsOptional, IsString, IsUrl } from 'class-validator';

export class RemoveVideoBackgroundDto {
  @IsString()
  @IsUrl()
  videoUrl: string;

  /**
   * Optional explicit removal model (e.g. `lucataco/rembg-video` for white
   * backgrounds, `arielreplicate/robust_video_matting` for green screens).
   * Must be on the 'video-background' allowlist — anything else is a 400.
   * Omitted = the org's configured default (Auto).
   */
  @IsOptional()
  @IsString()
  model?: string;
}
