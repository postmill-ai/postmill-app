import { IsNotEmpty, IsNumber, IsString, IsUrl, Min } from 'class-validator';

export class VideoSegmentTransformDto {
  @IsString()
  @IsUrl()
  videoUrl: string;

  @IsString()
  @IsNotEmpty()
  prompt: string;

  // Source-time bounds (ms) of the segment to extract before the
  // video-to-video transform. trimEndMs is clamped to the probed source
  // duration server-side; the span is capped (see the segment service).
  @IsNumber()
  @Min(0)
  trimStartMs: number;

  @IsNumber()
  @Min(1)
  trimEndMs: number;
}
