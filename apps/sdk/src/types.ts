/**
 * Minimal request/response type mirrors for the public API v1 DTOs.
 *
 * These are intentionally local to the published SDK so that `dist/index.d.ts`
 * stays self-contained and does not import private monorepo packages such as
 * `@postmill-ai/nestjs-libraries` or `@prisma/client` (see S6).
 *
 * When backend DTOs change, update the corresponding shape here. Only fields
 * that the SDK actually sends or receives are typed; everything else is left
 * as `unknown` to avoid inventing contracts.
 */

export interface CreatePostDto {
  type: 'draft' | 'schedule' | 'now' | 'update';
  date: string;
  shortLink: boolean;
  tags: Array<{ value: string; label: string }>;
  posts: unknown[];
  order?: string;
  creationMethod?: string;
  campaignId?: string;
  brandId?: string;
  inter?: number;
}

export interface GetPostsDto {
  startDate: string;
  endDate: string;
  customer?: string;
  limit?: number;
  cursor?: number;
  display?: string;
}

export interface UploadDto {
  url: string;
}

export interface ChangePostStatusDto {
  status: 'draft' | 'schedule';
}

export interface UpdateReleaseIdDto {
  releaseId: string;
}

export interface VideoDto {
  type: string;
  output: 'vertical' | 'horizontal';
  customParams?: Record<string, unknown>;
}

export interface VideoFunctionDto {
  identifier: string;
  functionName: string;
  params?: Record<string, unknown>;
}

export interface TriggerIntegrationToolDto {
  methodName: string;
  data?: Record<string, string>;
}

export interface GetNotificationsDto {
  page?: number;
}

/**
 * Paged response for `GET /public/v1/posts`. The route ALWAYS returns this
 * shape; `cursor` is the offset for the next page and is `null` on the last
 * page.
 */
export interface PostListResponse {
  posts: unknown[];
  cursor: number | null;
}

/**
 * Frozen public contract for `POST /public/v1/generate-video` and its poll
 * route `GET /public/v1/generate-video/:id` — the media-job-native shape.
 *
 * - `id`: the job id when a job was queued; `null` on a synchronous
 *   completion (nothing to poll — `artifactUrl` is already set).
 * - `status`: `'completed'` and `'failed'` are BOTH terminal; every other
 *   state is reported as `'pending'`.
 * - `artifactUrl`: the finished media URL, only when status is `'completed'`.
 * - `provider`: the media provider that ran the job (poll route only).
 * - `error`: the failure reason, only on a `'failed'` job.
 *
 * Do not change field names or semantics without introducing a new API version.
 */
export interface VideoJobResponse {
  id: string | null;
  status: 'pending' | 'completed' | 'failed';
  artifactUrl: string | null;
  provider: string | null;
  error: string | null;
}
