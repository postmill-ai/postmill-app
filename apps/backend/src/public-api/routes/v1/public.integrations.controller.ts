import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { parseQualified } from '@gitroom/provider-kernel';
import { Throttle } from '@nestjs/throttler';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import {
  validateDateRange,
  validateToGteFrom,
  validateWindowCap,
} from '@gitroom/nestjs-libraries/analytics/date-range.validation';
import dayjs from 'dayjs';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { ChangePostStatusDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.status.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { UploadDto } from '@gitroom/nestjs-libraries/dtos/file/upload.dto';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@gitroom/nestjs-libraries/dtos/notifications/get.notifications.dto';
import { Readable } from 'stream';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fromBuffer } = require('file-type');

// J2 — hard cap for the public `/posts` list (default page size == max).
const PUBLIC_POSTS_MAX_LIMIT = 100;

const PUBLIC_API_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);
import * as Sentry from '@sentry/nestjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  AiDefaultsService,
  DefaultNotConfiguredError,
} from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { UpdateReleaseIdDto } from '@gitroom/nestjs-libraries/dtos/posts/update-release-id.dto';
import { TriggerIntegrationToolDto } from '@gitroom/nestjs-libraries/dtos/integrations/trigger-integration-tool.dto';

@ApiTags('Public API')
@ApiSecurity('api-key')
@ApiBearerAuth('bearer')
@Controller('/public/v1')
export class PublicIntegrationsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _fileService: FileService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _analyticsService: AnalyticsService,
    private _storageService: StorageService,
    private _aiDefaults: AiDefaultsService,
    private _aiMediaService: AiMediaService,
    private _campaignsService: CampaignsService
  ) {}

  @Post('/upload')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. Repeats with the same key within 24h replay the first response instead of re-uploading.',
  })
  @ApiResponse({ status: 201, description: 'The saved file record.' })
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    const adapter = await this._storageService.getLocalAdapterForOrg(org.id);
    const getFile = await adapter.uploadFile(file);
    return this._fileService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path
    );
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const response = await safeFetch(body.url);
    if (!response.ok) {
      throw new HttpException({ msg: 'Failed to fetch URL' }, 400);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const detected = await fromBuffer(buffer);
    if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException({ msg: 'Unsupported file type.' }, 400);
    }
    const mimetype = detected.mime;
    const ext = detected.ext;

    const adapter = await this._storageService.getLocalAdapterForOrg(org.id);
    const getFile = await adapter.uploadFile({
      buffer,
      mimetype,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${ext}`,
      encoding: '',
    });

    return this._fileService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path
    );
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/posts')
  @ApiResponse({
    status: 200,
    description:
      'Posts in the requested publish-date window, capped at `limit` (default/max 100). ' +
      '`cursor` is the offset for the next page; it is null when the last page is reached.',
  })
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const all = await this._postsService.getPosts(org.id, query);

    // J2 — bound the previously-unbounded array. Back-compat: when no paging
    // param is sent we still return `{ posts }`, just capped at the hard max
    // rather than the whole window.
    const offset = query.cursor ?? 0;
    const limit = query.limit ?? PUBLIC_POSTS_MAX_LIMIT;
    const posts = all.slice(offset, offset + limit);

    // J2 back-compat: legacy n8n/Zapier clients expect `{ posts }`. Only include
    // the paging cursor when the caller explicitly requested pagination.
    if (query.cursor === undefined && query.limit === undefined) {
      return { posts };
    }

    const nextOffset = offset + limit;
    const cursor = nextOffset < all.length ? nextOffset : null;

    return {
      posts,
      cursor,
      // comments,
    };
  }

  @Post('/posts')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. Repeats with the same key within 24h replay the first response instead of creating a duplicate post.',
  })
  @ApiResponse({ status: 201, description: 'The created post group.' })
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.API],
    [AuthorizationActions.Create, Sections.POSTS_PER_MONTH]
  )
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: CreatePostDto
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const creationMethod =
      rawBody.creationMethod === 'CLI' || rawBody.creationMethod === 'API'
        ? rawBody.creationMethod
        : 'API';

    // 4.2d — reject scheduling/publishing onto a disabled or refresh-needed
    // channel at create time (the publish would otherwise fail later). Drafts
    // are allowed so the user can reconnect before promoting.
    if (rawBody.type !== 'draft') {
      for (const p of rawBody.posts || []) {
        const integrationId = p?.integration?.id;
        if (!integrationId) {
          continue;
        }
        const channel = await this._integrationService.getIntegrationById(
          org.id,
          integrationId
        );
        if (channel && (channel.disabled || channel.refreshNeeded)) {
          throw new HttpException(
            {
              msg: `Channel ${channel.name} is disconnected or needs reauthentication. Reconnect it before scheduling.`,
            },
            400
          );
        }
      }
    }

    return this._postsService.validateAndCreatePost(
      org.id,
      rawBody,
      creationMethod,
      true,
    );
  }

  @Delete('/posts/:id')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional. Repeats with the same key within 24h replay the first response.',
  })
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getPostById = await this._postsService.getPost(org.id, id);
    // 4.2b — an unknown/foreign id resolves to null; reading `.group` would 500.
    if (!getPostById?.group) {
      throw new HttpException({ msg: 'Post not found' }, 404);
    }
    return this._postsService.deletePost(org.id, getPostById.group);
  }

  @Delete('/posts/group/:group')
  deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deletePost(org.id, group);
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { connected: true };
  }

  @Get('/groups')
  async listGroups(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.customers(org.id)).map(
      (customer) => ({
        id: customer.id,
        name: customer.name,
      })
    );
  }

  @Get('/integrations')
  async listIntegration(
    @GetOrgFromRequest() org: Organization,
    @Query('group') group?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.getIntegrationsList(org.id))
      .filter((integration) => !group || integration.customer?.id === group)
      .map((integration) => ({
        id: integration.id,
        name: integration.name,
        identifier: integration.providerIdentifier,
        picture: integration.picture,
        disabled: integration.disabled,
        profile: integration.profile,
        customer: integration.customer
          ? {
              id: integration.customer.id,
              name: integration.customer.name,
            }
          : undefined,
      }));
  }

  @Get('/social/:integration')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.API],
    [AuthorizationActions.Create, Sections.CHANNEL]
  )
  @ApiQuery({
    name: 'version',
    required: false,
    description:
      'Optional provider version (e.g. "v1"). The provider id may also be passed qualified as "providerId@version" in the path. A bare id resolves the latest active version.',
  })
  @ApiResponse({
    status: 410,
    description:
      'Gone — the requested provider version has been retired. The body includes { providerId, version, latestActive }.',
  })
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization,
    @Query('version') version?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Accept either a qualified id ("providerId@version") in the path or an
    // optional ?version= query param. A bare id keeps the original behaviour
    // (resolve the latest active version) for n8n/Zapier backward compatibility.
    const { providerId, version: qualifiedVersion } = parseQualified(integration);
    const requestedVersion = qualifiedVersion ?? version;

    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(providerId)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    let integrationProvider =
      await this._integrationManager.getSocialIntegration(providerId);

    // When a specific version is requested, pin to that version through the
    // kernel resolution path; an unknown version resolves to undefined → 404.
    if (requestedVersion) {
      const pinned = this._integrationManager.getSocialIntegrationUnchecked(
        providerId,
        requestedVersion
      );
      if (!pinned) {
        throw new HttpException(
          { msg: 'Integration version not available' },
          404
        );
      }
      integrationProvider = pinned;
    }

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        {
          msg: 'This integration requires an external URL and is not supported via the public API',
        },
        400
      );
    }

    try {
      const clientInformation = await this._integrationManager.requireClientInformation(
        providerId,
        org.id
      );

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl(clientInformation);

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);

      return { url };
    } catch (err) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginatedForOrg(
      org.id,
      query.page ?? 0
    );
  }

  @Post('/generate-video')
  async generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const params = body.customParams || {};
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';

    let artifact: string;
    try {
      if (body.type === 'image-to-video' || params.imageUrl) {
        artifact = await this._aiDefaults.imageToVideo(
          org.id,
          prompt,
          params.imageUrl as string,
        );
      } else if (body.type === 'video-to-video' || params.videoUrl) {
        artifact = await this._aiDefaults.videoToVideo(
          org.id,
          prompt,
          params.videoUrl as string,
        );
      } else {
        artifact = await this._aiDefaults.textToVideo(org.id, prompt);
      }
    } catch (err) {
      if (err instanceof DefaultNotConfiguredError) {
        throw new HttpException(
          { error: err.message, category: err.category },
          409,
        );
      }
      throw err;
    }

    // FROZEN PUBLIC CONTRACT — do not change field names/semantics without a new
    // versioned route. Legacy n8n/Zapier clients read `response.path` as the finished
    // video URL. This endpoint used to be synchronous (always a URL); it is now async,
    // so the response is self-describing and back-compatible:
    //   - `id`     : back-compat — '' when completed, the AIMediaJob id when pending
    //                (matches the historical { id, path, name } File-like shape).
    //   - `status` : 'completed' when a finished URL is available synchronously
    //                (image / data: / url fallback), 'pending' when a job was queued.
    //   - `jobId`  : the AIMediaJob id when pending, '' otherwise.
    //   - `path`   : the finished media URL when completed; '' when pending (poll instead).
    //   - `name`   : preserved from the historical shape (always '').
    //   - `pollUrl`: when pending, the public route to GET (with the same API key) to poll
    //                job completion — `GET /public/v1/generate-video/:id` below; '' when completed.
    const looksLikeUrl =
      typeof artifact === 'string' &&
      (artifact.startsWith('http') || artifact.startsWith('data:'));

    if (looksLikeUrl) {
      return {
        id: '',
        status: 'completed',
        jobId: '',
        path: artifact,
        name: '',
        pollUrl: '',
      };
    }

    return {
      id: artifact,
      status: 'pending',
      jobId: artifact,
      path: '',
      name: '',
      pollUrl: `/public/v1/generate-video/${artifact}`,
    };
  }

  // Public, API-key-reachable poll route for the async /generate-video job above.
  // FROZEN PUBLIC CONTRACT — mirrors the generate-video response keys so a legacy client
  // can GET this with the same API key until it reaches a terminal state and read `path`.
  // `status` is one of 'pending' | 'completed' | 'failed'. `completed` and `failed` are
  // BOTH terminal — `pollUrl` is '' for either so a client looping `while (pollUrl)` (or
  // `while (status === 'pending')`) stops on failure instead of polling a dead job forever.
  // `error` carries the failure reason on a failed job ('' otherwise).
  @Get('/generate-video/:id')
  async getGenerateVideoJob(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const job = await this._aiMediaService.getJob(id, org.id);
    if (!job || job.organizationId !== org.id) {
      throw new HttpException('Job not found', 404);
    }

    const completed = job.status === 'completed';
    const failed = job.status === 'failed';
    const terminal = completed || failed;
    return {
      id: job.id,
      status: completed ? 'completed' : failed ? 'failed' : 'pending',
      jobId: job.id,
      path: completed ? job.artifactUrl || '' : '',
      name: '',
      pollUrl: terminal ? '' : `/public/v1/generate-video/${job.id}`,
      error: job.error || '',
    };
  }

  @Post('/video/function')
  async videoFunction(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoFunctionDto
  ) {
    Sentry.metrics.count('public_api-request', 1);

    if (body.functionName !== 'loadVoices') {
      throw new HttpException(
        `Function ${body.functionName} not supported`,
        400,
      );
    }

    const voices = await this._aiMediaService.listVoices(org.id, {
      provider: body.identifier,
    });
    return {
      voices: voices.map((v) => ({
        id: v.id,
        name: v.label,
        preview_url: v.previewUrl,
      })),
    };
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postsService.deletePost(org.id, post.group).catch(() => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!loadIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = this._integrationManager.getSocialIntegrationUnchecked(
      loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/posts/:id/status')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.API],
    [AuthorizationActions.Create, Sections.POSTS_PER_MONTH]
  )
  async changePostStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ChangePostStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.changePostStatus(org.id, id, body.status);
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateReleaseIdDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updateReleaseId(org.id, id, body.releaseId);
  }

  // 6.8: public v2 campaign analytics. Registered BEFORE the single-segment
  // `/analytics/:integration` legacy route so the static two-segment path isn't
  // captured by the param route. Gated like `/analytics/overview` — the public
  // per-minute @Throttle, no @CheckPolicies (API-key read parity with the legacy
  // siblings). Org-ownership is enforced by CampaignsService.get (→ 404).
  @Get('/analytics/campaign/:id')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getCampaignAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const campaign = await this._campaignsService.get(id, org.id);
    if (!campaign) {
      throw new HttpException({ msg: 'Campaign not found' }, 404);
    }

    const to = toStr || dayjs().format('YYYY-MM-DD');
    const from = fromStr || dayjs().subtract(90, 'day').format('YYYY-MM-DD');

    // R2.4 — validate the resolved window before any downstream dayjs use, and
    // cap it (public route) so a large range can't blow up query cost.
    validateDateRange(from, to);
    validateToGteFrom(from, to);
    validateWindowCap(from, to);

    const overview = await this._analyticsService.getOverview(
      org,
      from,
      to,
      [],
      false,
      { campaignIds: [id] }
    );

    return { ...overview, window: { from, to } };
  }

  // 6.8: public v2 anomaly feed. Static single-segment path — registered before
  // `/analytics/:integration` so it resolves to this route, not the param one.
  // Same gating as `/analytics/overview` (@Throttle, no @CheckPolicies).
  @Get('/analytics/anomalies')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getAnomalies(
    @GetOrgFromRequest() org: Organization,
    @Query('limit') limit?: string,
    @Query('includeDismissed') includeDismissed?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._analyticsService.listAnomalies(org.id, {
      limit: limit ? Math.min(Math.max(+limit || 0, 1), 100) : undefined,
      includeDismissed: includeDismissed === 'true',
    });
  }

  // R2.7 (M9): the static `/analytics/overview` route MUST be registered BEFORE
  // the single-segment `/analytics/:integration` param route — Express resolves by
  // registration order, so declared after it `overview` was captured as
  // integration='overview' and 500'd (its @Throttle + docs were dead). Same
  // pattern the branch already applied to `/analytics/anomalies` above.
  @Get('/analytics/overview')
  // 0.8: kept ungated by @CheckPolicies to match its legacy siblings (:636/:646,
  // n8n/Zapier compat) — API-key read routes carry no entitlement gate. Instead it
  // carries the documented public per-minute @Throttle (org-scoped via the guard's
  // getTracker on req.org.id) since the overview can fan out to live provider analytics.
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getAnalyticsOverview(
    @GetOrgFromRequest() org: Organization,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('integrations') integrations: string,
    @Query('compare') compare: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Same validation + window cap as the authed v2 date routes: garbage dates
    // must 400 (not reach Prisma), and an unbounded range must not drive the
    // day-by-day aggregation loops on an API-key request.
    validateDateRange(from, to);
    validateToGteFrom(from, to);
    validateWindowCap(from, to);
    return this._analyticsService.getOverview(
      org,
      from,
      to,
      integrations ? integrations.split(',') : [],
      compare === 'true'
    );
  }

  @Get('/analytics/:integration')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/analytics/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Post('/integration-trigger/:id')
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: TriggerIntegrationToolDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegrationUnchecked(
        getIntegration.providerIdentifier
      )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 400);
    }

    // 4.2c — cap the token-refresh retries. A provider that keeps throwing
    // RefreshToken (or a refresh that keeps returning a token that still fails)
    // must not spin forever; give up and 502 after a bounded number of attempts.
    const MAX_REFRESH_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      try {
        // @ts-ignore
        const result = await integrationProvider[body.methodName](
          getIntegration.token,
          body.data || {},
          getIntegration.internalId,
          getIntegration
        );

        return { output: result };
      } catch (err) {
        if (err instanceof RefreshToken) {
          // Retries exhausted — stop looping and surface a 502 instead of
          // spinning forever on a token that never becomes valid.
          if (attempt >= MAX_REFRESH_RETRIES) {
            throw new HttpException(
              { msg: 'Integration tool failed after token refresh retries' },
              502
            );
          }

          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          const { accessToken } = data;

          if (accessToken) {
            getIntegration.token = accessToken;

            if (integrationProvider.refreshWait) {
              await timer(10000);
            }

            continue;
          }
        }
        throw new HttpException({ msg: 'Unexpected error' }, 500);
      }
    }

    // Unreachable in practice (every iteration returns or throws), but keeps the
    // method's return type total and guards against a future edit to the loop.
    throw new HttpException(
      { msg: 'Integration tool failed after token refresh retries' },
      502
    );
  }
}
