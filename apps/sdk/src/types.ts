/**
 * Minimal request/response type mirrors for the public API v1 DTOs.
 *
 * These are intentionally local to the published SDK so that `dist/index.d.ts`
 * stays self-contained and does not import private monorepo packages such as
 * `@gitroom/nestjs-libraries` or `@prisma/client` (see S6).
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
 * Frozen public contract for `/generate-video` and its poll route.
 *
 * Do not change field names or semantics without introducing a new API version.
 */
export interface VideoJobResponse {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  jobId: string;
  path: string;
  name: string;
  pollUrl: string;
  error?: string;
}
