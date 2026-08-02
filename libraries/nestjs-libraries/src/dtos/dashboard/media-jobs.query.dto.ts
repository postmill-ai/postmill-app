import { IsIn, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/** Job states the queue can filter by. Mirrors AIMediaJob.status. */
export const MEDIA_JOB_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const;

/**
 * Query for `GET /dashboard/media-jobs`.
 *
 * Every field is optional so the dashboard widget's bare call keeps returning
 * the original 20-job payload; the queue page supplies filters and a cursor.
 */
export class MediaJobsQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : parseInt(value, 10)))
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(MEDIA_JOB_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  /**
   * Id of the last job on the previous page. Prisma ids here are cuids, not
   * uuids — validating as a uuid rejected every real cursor with a 400.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  cursor?: string;
}
