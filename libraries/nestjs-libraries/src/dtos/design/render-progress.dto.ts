import { IsInt, Min } from 'class-validator';

/**
 * Progress report POSTed by the container render worker to
 * /media/designs/render-progress/:jobId (token-gated, like render-frame).
 */
export class RenderProgressDto {
  /** Frames captured so far (1-based global count across parallel capture pages). */
  @IsInt()
  @Min(0)
  frame!: number;

  /** Total frames in the render. */
  @IsInt()
  @Min(1)
  total!: number;
}
