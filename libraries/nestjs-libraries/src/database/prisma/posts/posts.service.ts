import {
  BadRequestException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { PostValidationException } from '@gitroom/nestjs-libraries/errors/post-validation.exception';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { ValidatePostsDto } from '@gitroom/nestjs-libraries/dtos/posts/validate.posts.dto';
import { BulkCreatePostsDto, BulkCreatePostRowDto } from '@gitroom/nestjs-libraries/dtos/posts/bulk.create.posts.dto';
import dayjs from 'dayjs';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.repository';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  CreationMethod,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  minifyPostsList,
  minifyPosts,
} from '@gitroom/helpers/utils/posts.list.minify';
import sharp from 'sharp';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
import * as Sentry from '@sentry/nestjs';
import { RagService } from '@gitroom/nestjs-libraries/ai/governance/rag.service';
import { inngest, isInngestEnabled } from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { normalizeMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshTokenError } from '@gitroom/nestjs-libraries/inngest/errors';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { weightedLength } from '@gitroom/helpers/utils/count.length';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

@Injectable()
export class PostsService {
  constructor(
    private _postRepository: PostsRepository,
    // layering: sanctioned leaf-read of AnalyticsRepository (AnalyticsService → PostsService, routing up would cycle)
    private _analyticsRepository: AnalyticsRepository,
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _fileService: FileService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _ragService: RagService,
    private _storageService: StorageService,
    // layering: sanctioned leaf-read of CampaignsRepository (CampaignsService → PostsService, routing up would cycle)
    private _campaignsRepository: CampaignsRepository,
    private _auditService: AuditService,
    @Inject(forwardRef(() => SubscriptionService))
    private _subscriptionService: SubscriptionService,
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  // 0.7 follow-up: recover posts orphaned in the PUBLISHING claim (see repository).
  resetStalePublishingToQueue() {
    return this._postRepository.resetStalePublishingToQueue();
  }

  updatePost(id: string, postId: string, releaseURL: string, orgId: string) {
    return this._postRepository.updatePost(id, postId, releaseURL, orgId);
  }

  updatePostSettings(id: string, settings: string, orgId: string) {
    return this._postRepository.updatePostSettings(id, settings, orgId);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    // Unchecked lookup: analytics/missing-content operate on an already-connected
    // channel and must keep working even if the provider was later disabled for
    // new connections (the gated getSocialIntegration would throw a 404 here).
    const integrationProvider =
      this._integrationManager.getSocialIntegrationUnchecked(
        post.integration.providerIdentifier,
        post.integration.providerVersion ?? undefined
      );

    if (!integrationProvider?.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      Logger.warn(`getMissingContent error: ${(e as Error)?.message}`);
      if (e instanceof RefreshTokenError) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  updateCommentCount(postId: string, count: number, orgId: string) {
    return this._postRepository.updateCommentCount(postId, count, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    // Unchecked lookup: see getMissingContent above — keep analytics working for
    // already-connected channels whose provider was later disabled.
    const integrationProvider =
      this._integrationManager.getSocialIntegrationUnchecked(
        post.integration.providerIdentifier,
        post.integration.providerVersion ?? undefined
      );

    if (!integrationProvider?.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    const getIntegrationData = await ioRedis.get(
      `integration:${orgId}:${post.id}:${date}`
    );
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    try {
      const clientInformation = await this._integrationManager.requireClientInformation(
        getIntegration.providerIdentifier,
        getIntegration.organizationId,
        getIntegration.providerConfigId
      ).catch(() => undefined);

      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date,
        clientInformation
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      Logger.warn(`checkPostAnalytics error: ${(e as Error)?.message}`);
      if (e instanceof RefreshTokenError) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async enrichPostsWithLatestStats(orgId: string, posts: any[]) {
    const disableX = !!process.env.DISABLE_X_ANALYTICS;

    const qualifyingPosts = posts.filter((p) => {
      if (p.lastViews !== null && p.lastViews !== undefined) return false;
      if (p.lastLikes !== null && p.lastLikes !== undefined) return false;
      if (p.lastComments !== null && p.lastComments !== undefined) return false;
      if (p.state !== 'PUBLISHED') return false;
      if (!p.releaseId || p.releaseId === 'missing') return false;
      if (disableX && p.integration?.providerIdentifier === 'x') return false;
      return true;
    });

    if (!qualifyingPosts.length) return;

    const postIds = qualifyingPosts.map((p) => p.id);
    if (!postIds.length) return;

    const latestByPost: Record<string, Record<string, number>> = {};

    try {
      const snapshots = await this._analyticsRepository.getLatestPostSnapshots(orgId, postIds, ['views', 'likes', 'comments']);

      for (const snap of snapshots) {
        if (!latestByPost[snap.postId]) {
          latestByPost[snap.postId] = {};
        }
        if (!(snap.metric in latestByPost[snap.postId])) {
          latestByPost[snap.postId][snap.metric] = snap.value;
        }
      }

      for (const post of qualifyingPosts) {
        const metrics = latestByPost[post.id];
        if (!metrics) continue;
        if ('views' in metrics) post.lastViews = metrics.views;
        if ('likes' in metrics) post.lastLikes = metrics.likes;
        if ('comments' in metrics) post.lastComments = metrics.comments;
      }
    } catch (e) {
      Logger.warn(`enrichPostsWithLatestStats error: ${(e as Error)?.message}`);
    }

    // Second tier: live fallback for posts still missing metrics after the snapshot pass
    const residualPosts = qualifyingPosts.filter((p) => {
      const metrics = latestByPost[p.id];
      if (!metrics) return true;
      return !('views' in metrics) && !('likes' in metrics) && !('comments' in metrics);
    });

    if (residualPosts.length > 0) {
      const cap = 10;
      const batch = residualPosts.slice(0, cap);
      await Promise.allSettled(
        batch.map(async (post) => {
          try {
            const result = await this.checkPostAnalytics(orgId, post.id, Date.now());
            if (!Array.isArray(result)) return;

            // Mirror the snapshot pipeline (analytics.activity): normalize each
            // provider label to a canonical metric, then take the latest data point.
            const latestByMetric: Record<string, number> = {};
            for (const entry of result) {
              const canonical = normalizeMetric(
                post.integration?.providerIdentifier,
                entry.label
              );
              if (!canonical || canonical in latestByMetric) continue;

              let latest: { total: string; date: string } | undefined;
              for (const point of entry.data ?? []) {
                if (!latest || dayjs(point.date).isAfter(dayjs(latest.date))) {
                  latest = point;
                }
              }
              if (!latest) continue;

              const val = parseFloat(String(latest.total));
              if (isNaN(val)) continue;
              latestByMetric[canonical] = val;
            }

            const views = latestByMetric['views'] ?? latestByMetric['impressions'];
            const likes = latestByMetric['likes'] ?? latestByMetric['reactions'];
            const comments = latestByMetric['comments'] ?? latestByMetric['replies'];
            if (views !== undefined) post.lastViews = views;
            if (likes !== undefined) post.lastLikes = likes;
            if (comments !== undefined) post.lastComments = comments;
          } catch {
            // Best-effort — individual failures don't reject the batch
          }
        })
      );
    }
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      orgId,
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body?.type,
      posts: await Promise.all(
        body?.posts?.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `Integration with id ${post.integration.id} not found`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body?.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        }) || []
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      orgId || '',
      includeIntegration,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto, userId?: string) {
    const posts = await this._postRepository.getPosts(orgId, query, userId);
    if (posts?.length) {
      await this.enrichPostsWithLatestStats(orgId, posts);
    }
    return minifyPosts({ posts });
  }

  async getPostsList(orgId: string, query: GetPostsListDto, userId?: string) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query, userId)
    );
  }

  async setGroupColor(orgId: string, group: string, color: string | null) {
    return this._postRepository.setGroupColor(orgId, group, color);
  }

  async updateMedia(id: string, imagesList: any[], convertToJPEG = false, orgId: string) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.path && p.id) {
                imageUpdateNeeded = true;
                return this._fileService.getFileById(orgId, p.id);
              }

              return p;
            })
          )
        )
          .map((m) => {
            return {
              ...m,
              url:
                m.path.indexOf('http') === -1
                  ? process.env.FRONTEND_URL +
                    '/' +
                    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                    m.path
                  : m.path,
              type: 'image',
              path:
                m.path.indexOf('http') === -1
                  ? process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (!convertToJPEG) {
              return m;
            }

            if (hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              const imageBuffer = Buffer.from(await readOrFetch(m.path));

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer)
                .jpeg({ quality: 100 })
                .toBuffer();

              const adapter = await this._storageService.getLocalAdapterForOrg(orgId, true);
              const { path, originalname } = adapter
                ? await adapter.uploadFile({
                    buffer,
                    mimetype: 'image/jpeg',
                    size: buffer.length,
                    path: '',
                    fieldname: '',
                    destination: '',
                    stream: new Readable(),
                    filename: '',
                    originalname: '',
                    encoding: '',
                  })
                : { path: '', originalname: '' };

              return {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList),
          orgId
        );
      }

      return getImageList;
    } catch (err: any) {
      return imagesList;
    }
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this._stripIntegrationSecrets(
      this.arrangePostsByGroup(loadAll, undefined)
    );
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this._stripIntegrationSecrets(
      this.arrangePostsByGroup(loadAll, undefined)
    );

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG,
            orgId
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  /**
   * Re-project each post's decrypted `integration` down to safe display fields
   * before returning it over HTTP. The repo layer (and `getPostsRecursively`)
   * decrypt `token`/`refreshToken` for the Inngest publisher, which shares
   * `repository.getPost` — those secrets must never leave the server. Mirrors
   * the calendar list `select`. Strip here, never in the repo.
   */
  private _stripIntegrationSecrets(posts: any[]): any[] {
    return (posts || []).map((post) => {
      if (!post?.integration) {
        return post;
      }
      const { id, providerIdentifier, name, picture, profile } =
        post.integration;
      return {
        ...post,
        integration: { id, providerIdentifier, name, picture, profile },
      };
    });
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = this._stripIntegrationSecrets(
      await this.getPostsRecursively(id, true, orgId, true)
    );
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG,
            orgId
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(
    orgId: string,
    date: string,
    options?: { take?: number; page?: number }
  ) {
    return this._postRepository.getOldPosts(orgId, date, options);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        if (isInngestEnabled()) {
          await inngest.send({
            name: 'post/cancel',
            data: { postId: post.id },
          });
        } else {
          Logger.debug(
            `Skipping post/cancel event for post ${post.id} — Inngest is disabled`
          );
        }
      } catch (err) {}
    }

    return { error: true };
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string, orgId: string) {
    return this._postRepository.getPostByForWebhookId(id, orgId);
  }

  async startWorkflow(
    providerIdentifier: string,
    postId: string,
    orgId: string,
    state: State,
    providerVersion?: string
  ) {
    const provider =
      this._integrationManager.getSocialIntegrationUnchecked(
        providerIdentifier,
        providerVersion ?? undefined
      );
    const taskQueue = providerIdentifier.split('-')[0].toLowerCase();
    const maxConcurrentJob = provider?.maxConcurrentJob ?? 1;

    try {
      if (isInngestEnabled()) {
        await inngest.send({
          name: 'post/cancel',
          data: { postId },
        });
      } else {
        this._warnInngestDisabledOnce();
      }
    } catch (err) {
      Logger.error(
        `Failed to send post/cancel event for post ${postId}: ${
          (err as Error)?.message
        }`
      );
    }

    if (state === 'DRAFT') {
      return;
    }

    try {
      if (isInngestEnabled()) {
        await inngest.send({
          name: 'post/publish',
          data: {
            postId,
            organizationId: orgId,
            taskQueue,
            maxConcurrentJob,
          },
          // Unique-per-send id: a constant `post_${postId}` is an Inngest
          // idempotency key that dedupes every reschedule/edit for ~24h,
          // black-holing the post. Genuine double-sends are caught by the
          // atomic publish claim, not by event dedup.
          id: `post_${postId}_${uuidv4()}`,
        });
      } else {
        this._warnInngestDisabledOnce();
      }
    } catch (err) {
      Logger.error(
        `Failed to send post/publish event for post ${postId}: ${
          (err as Error)?.message
        }`
      );
    }
  }

  private static _inngestDisabledWarned = false;

  /** One-time boot warning so silent no-op scheduling (USE_INNGEST !== 'true') is visible. */
  private _warnInngestDisabledOnce() {
    if (PostsService._inngestDisabledWarned) {
      return;
    }
    PostsService._inngestDisabledWarned = true;
    Logger.warn(
      'USE_INNGEST is not enabled — post scheduling events are being skipped (no-op). Publishing/rescheduling will not fire.'
    );
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value?: Array<{
        content?: string;
        image?: Array<{ path: string; thumbnail?: string }>;
      }>;
      settings?: any;
    }>
  ) {
    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = await this._integrationService.getIntegrationById(
          orgId,
          post?.integration?.id
        );

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post?.integration?.id} not found`
          );
        }

        const provider = await this._integrationManager.getSocialIntegration(
          integration.providerIdentifier,
          integration.organizationId
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: true,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          settingsError = this.firstValidationError(validationErrors);
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: string | true = true;
        try {
          errors = await provider.checkValidity(
            media,
            settings,
            additionalSettings
          );
        } catch (err: any) {
          errors = err?.message || 'Invalid media';
        }

        const maximumCharacters = provider.maxLength(additionalSettings);
        const isX = integration.providerIdentifier === 'x';

        const emptyContent = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const length = isX ? weightedLength(strip) : strip.length;
          return length === 0 && (a.image || []).length === 0;
        });

        const tooLong = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const weighted = isX ? weightedLength(strip) : strip.length;
          const totalCharacters =
            weighted > strip.length ? weighted : strip.length;
          return totalCharacters > (maximumCharacters || 1000000);
        });

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          name: integration.name,
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          maximumCharacters,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  private _parsePostJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async _appendUtmToMessages(
    messages: string[],
    campaignId: string | undefined,
    organizationId: string,
    providerIdentifier: string | undefined
  ): Promise<string[]> {
    if (!campaignId || !providerIdentifier) return messages;
    const campaign = await this._campaignsRepository.findById(campaignId, organizationId);
    if (!campaign?.utmEnabled) return messages;

    const slug = campaign.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const utm = `utm_campaign=${encodeURIComponent(slug)}&utm_source=${encodeURIComponent(providerIdentifier)}&utm_medium=social`;

    // Never re-process URLs already on the active short-link provider's domain:
    // on edit the stored content holds SHORT urls, and appending UTM to a short
    // link corrupts it (the shortener then skips it as already-on-domain). UTM
    // is only ever applied to raw source URLs, before the first shorten.
    let shortLinkDomain: string | undefined;
    try {
      const resolved = await this._shortLinkService.shouldShortlink(
        organizationId,
        []
      );
      shortLinkDomain = resolved?.domain;
    } catch {
      shortLinkDomain = undefined;
    }

    return messages.map((msg) =>
      msg.replace(/(https?:\/\/[^\s<"']+)/g, (url) => {
        // Don't swallow trailing punctuation into the URL — reattach it after.
        const trailing = url.match(/[).,]+$/)?.[0] || '';
        const core = trailing ? url.slice(0, -trailing.length) : url;
        if (core.includes('utm_campaign')) return url;
        if (shortLinkDomain && shortLinkDomain !== 'empty' && core.includes(shortLinkDomain)) {
          return url;
        }
        const sep = core.includes('?') ? '&' : '?';
        return `${core}${sep}${utm}${trailing}`;
      })
    );
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod
  ): Promise<any[]> {
    const postList = [];
    for (const post of body.posts) {
      const providerIdentifier = (post.settings as any)?.__type;
      const provider = await this._integrationManager.getSocialIntegration(
        providerIdentifier,
        orgId
      );
      const removeLinks = !!provider?.stripLinks?.();

      let messages = (post.value || []).map((p) => p.content);
      // Append campaign UTM params before short-linking so short links carry them.
      messages = await this._appendUtmToMessages(
        messages,
        body.campaignId,
        orgId,
        providerIdentifier
      );
      // No point shortlinking links on platforms that strip them out anyway
      const updateContent =
        !body.shortLink || removeLinks
          ? messages
          : await this._shortLinkService.convertTextToShortLinks(
              orgId,
              messages
            );

      post.value = (post.value || []).map((p, i) => ({
        ...p,
        content: removeLinks ? stripLinks(updateContent[i]) : updateContent[i],
      }));

      const { posts } = await this._postRepository.createOrUpdatePost(
        body.type,
        orgId,
        body.type === 'now' ? dayjs().format('YYYY-MM-DDTHH:mm:00') : body.date,
        post,
        body.tags,
        creationMethod,
        body.inter,
        body.campaignId,
        body.brandId,
      );

      if (!posts?.length) {
        return [] as any[];
      }

      if (body.type !== 'update') {
        this.startWorkflow(
          (post.settings as any)?.__type,
          posts[0].id,
          orgId,
          posts[0].state,
          posts[0].integration?.providerVersion ?? undefined
        ).catch((err) => {});
      }

      Sentry.metrics.count('post_created', 1);

      const postText = (post.value || []).map((v: any) => v.content).join('\n');
      this._ragService.enqueueIndexJob({
        organizationId: orgId,
        sourceType: 'post',
        sourceId: posts[0].id,
        content: postText,
      });

      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

    return postList;
  }

  async validateAndCreatePost(
    orgId: string,
    rawBody: any,
    creationMethod: CreationMethod,
    replaceDraft = false,
  ): Promise<any[]> {
    const body = await this.mapTypeToPost(rawBody, orgId, replaceDraft);

    if (replaceDraft) {
      (body as any).type = rawBody.type;
    }

    // Reject scheduling in the past — a past publishDate publishes immediately
    // (the worker clamps the sleep to 0) rather than at the intended time.
    // `now` is current by definition; `draft`/`update` legitimately carry
    // historical dates (draft promotion / editing an already-published post).
    if (
      body.type === 'schedule' &&
      body.date &&
      dayjs(body.date).isBefore(dayjs())
    ) {
      throw new BadRequestException('Cannot schedule a post in the past');
    }

    if (
      replaceDraft &&
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      body.posts.some((p) =>
        p.value.some((a) =>
          a.image.some(
            (i) => i.path.indexOf(process.env.RESTRICT_UPLOAD_DOMAINS!) === -1
          )
        )
      )
    ) {
      throw new HttpException(
        {
          msg: `All media must be uploaded through our upload API route and contain the domain: ${process.env.RESTRICT_UPLOAD_DOMAINS}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const validation = await this.validatePosts(orgId, body.posts || rawBody?.posts || []);

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(item, 'Your post should have at least one character or one image.');
      }
    }

    if (body.type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }

    return this.createPost(orgId, body, creationMethod);
  }

  async preflightCheck(
    orgId: string,
    body: ValidatePostsDto,
  ) {
    const results = await this.validatePosts(orgId, body.posts || []);

    // Batch the integration lookups into one query, then map by id (was one query per
    // result inside Promise.all — N parallel queries collapsed to 1).
    const integrations = await this._integrationService.getIntegrationsByIds(
      orgId,
      results.map((r) => r.id),
    );
    const integrationById = new Map(integrations.map((i) => [i.id, i]));

    const enhanced = results.map((result) => {
        const warnings: string[] = [];
        const blocks: string[] = [];

        const integration = integrationById.get(result.id) || null;
        const provider = integration
          ? this._integrationManager.getSocialIntegrationUnchecked(
              integration.providerIdentifier,
              integration.providerVersion ?? undefined
            )
          : null;

        if (result.emptyContent) {
          blocks.push('Post has no content or media');
        }

        if (result.tooLong) {
          blocks.push(`Post exceeds maximum length of ${result.maximumCharacters} characters`);
        }

        if (!result.valid) {
          blocks.push(result.settingsError || 'Invalid settings');
        }

        if (result.errors !== true) {
          blocks.push(result.errors as string);
        }

        // Check alt text on media
        const post = body.posts?.find((p) => p.integration?.id === result.id);
        if (post?.value) {
          for (const val of post.value) {
            if (val.image?.length) {
              for (const img of val.image) {
                if (!(img as any).alt) {
                  warnings.push('Some media items are missing alt text');
                  break;
                }
              }
            }
          }
        }

        // Check unsupported media formats
        const providerAny = provider as any;
        if (providerAny?.maxMedia) {
          for (const val of post?.value || []) {
            if ((val.image?.length || 0) > providerAny.maxMedia) {
              warnings.push(`Platform supports max ${providerAny.maxMedia} media items`);
            }
          }
        }

        // Link safety
        for (const val of post?.value || []) {
          if (val.content && /https?:\/\//.test(val.content)) {
            warnings.push('Post contains links — ensure they are safe and functional');
          }
        }

        // First comment / poll compatibility
        const settings: any = post?.settings || {};
        if (settings.firstComment && !providerAny?.comment) {
          warnings.push('First comment is not supported on this platform');
        }

        return {
          integrationId: result.id,
          identifier: result.identifier,
          name: result.name,
          valid: blocks.length === 0,
          warnings,
          blocks,
          maximumCharacters: result.maximumCharacters,
        };
      });

    return {
      passed: enhanced.every((r) => r.valid && r.warnings.length === 0),
      results: enhanced,
      blocking: enhanced.filter((r) => r.blocks.length > 0),
    };
  }

  async separatePosts(content: string, len: number) {
    return this._openaiService.separatePosts(content, len);
  }

  async changeState(id: string, state: State, orgId: string, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, orgId, err, body);
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }

    // A campaign draft may only be promoted to the schedule once it has been
    // approved — mirrors the `promoteDrafts` gate so this route can't bypass it.
    if (
      status === 'schedule' &&
      getPostById.campaignId &&
      getPostById.approvalStatus !== 'approved'
    ) {
      throw new BadRequestException('Draft not approved');
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    await this._postRepository.changeState(id, state, orgId);

    try {
      await this.startWorkflow(
        getPostById.integration.providerIdentifier,
        getPostById.id,
        orgId,
        state,
        getPostById.integration.providerVersion ?? undefined
      );
    } catch (err) {}

    return { id, state };
  }

  async getCampaignDrafts(orgId: string, campaignId: string) {
    const drafts = await this._postRepository.getCampaignDrafts(campaignId, orgId);
    const grouped: Record<string, typeof drafts> = {};
    for (const draft of drafts) {
      const key = draft.group || 'Uncategorized';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(draft);
    }
    return grouped;
  }

  async getCampaignPosts(orgId: string, campaignId: string) {
    return this._postRepository.getCampaignPosts(campaignId, orgId);
  }

  async setPostCampaign(orgId: string, postId: string, campaignId: string | null) {
    return this._postRepository.setPostCampaign(postId, orgId, campaignId);
  }

  async setCampaign(orgId: string, postId: string, campaignId: string | null) {
    return this.setPostCampaign(orgId, postId, campaignId);
  }

  async approveDraft(orgId: string, postId: string, approvedById: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.state !== 'DRAFT') {
      throw new BadRequestException('Draft not found');
    }
    await this._postRepository.updateApprovalStatus(postId, orgId, 'approved', approvedById);

    if (post.campaignId) {
      const campaign = await this._campaignsRepository.findById(post.campaignId, orgId);
      await this._auditService.create({
        organizationId: orgId,
        userId: approvedById,
        action: 'campaign.draft.approve',
        entity: 'campaign',
        entityId: post.campaignId,
        entityName: campaign?.name || undefined,
        details: JSON.stringify({ postId, postContent: post.content?.slice(0, 100) }),
      });
    }

    return { id: postId, approvalStatus: 'approved' };
  }

  async rejectDraft(orgId: string, postId: string, rejectedById?: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.state !== 'DRAFT') {
      throw new BadRequestException('Draft not found');
    }
    await this._postRepository.updateApprovalStatus(postId, orgId, 'rejected');

    if (post.campaignId) {
      const campaign = await this._campaignsRepository.findById(post.campaignId, orgId);
      await this._auditService.create({
        organizationId: orgId,
        userId: rejectedById,
        action: 'campaign.draft.reject',
        entity: 'campaign',
        entityId: post.campaignId,
        entityName: campaign?.name || undefined,
        details: JSON.stringify({ postId, postContent: post.content?.slice(0, 100) }),
      });
    }

    return { id: postId, approvalStatus: 'rejected' };
  }

  async setDraftPending(orgId: string, postId: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.state !== 'DRAFT') {
      throw new BadRequestException('Draft not found');
    }
    await this._postRepository.updateApprovalStatus(postId, orgId, 'pending');
    return { id: postId, approvalStatus: 'pending' };
  }

  async promoteDrafts(orgId: string, campaignId: string, postIds: string[], promotedById?: string) {
    const results: Array<{ id: string; status: 'promoted' | 'blocked' | 'not_found'; reason?: string }> = [];
    for (const id of postIds) {
      const post = await this._postRepository.getPostById(id, orgId);
      if (!post || post.state !== 'DRAFT' || post.campaignId !== campaignId) {
        results.push({ id, status: 'not_found' });
        continue;
      }
      if (post.approvalStatus !== 'approved') {
        results.push({ id, status: 'blocked', reason: 'Draft must be approved before promotion' });
        continue;
      }
      await this.changePostStatus(orgId, id, 'schedule');
      results.push({ id, status: 'promoted' });
    }

    const promotedCount = results.filter((r) => r.status === 'promoted').length;
    if (promotedCount > 0) {
      const campaign = await this._campaignsRepository.findById(campaignId, orgId);
      await this._auditService.create({
        organizationId: orgId,
        userId: promotedById,
        action: 'campaign.promote',
        entity: 'campaign',
        entityId: campaignId,
        entityName: campaign?.name || undefined,
        details: JSON.stringify({ count: promotedCount, postIds }),
      });
    }

    return results;
  }

  buildCreateDtoFromPost(post: any): any {
    // Read-only DTO snapshot suitable for creating a new draft clone.
    // Post.settings and Post.image are JSON strings in the DB — parse them
    // before handing them back to createOrUpdatePost, which stringifies again.
    const settings = this._parsePostJson(post.settings, {});
    const image = this._parsePostJson(post.image, []);
    const values = [
      {
        content: post.content || '',
        image,
        delay: post.delay || 0,
      },
    ];

    // Preserve direct thread children if they were loaded (best-effort).
    if (Array.isArray(post.childrenPost)) {
      for (const child of post.childrenPost) {
        values.push({
          content: child.content || '',
          image: this._parsePostJson(child.image, []),
          delay: child.delay || 0,
        });
      }
    }

    return {
      type: 'draft',
      date: post.publishDate ? new Date(post.publishDate).toISOString() : new Date().toISOString(),
      posts: [
        {
          integration: { id: post.integration?.id || post.integrationId },
          value: values,
          settings,
        },
      ],
      tags: [],
      shortLink: false,
      campaignId: undefined,
      brandId: post.brandId,
    };
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state === 'DRAFT',
      action
    );

    // Don't re-queue an already-published post when rescheduling.
    if (action === 'schedule' && getPostById.state !== 'PUBLISHED') {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier,
          getPostById.id,
          orgId,
          getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE',
          getPostById.integration.providerVersion ?? undefined
        );
      } catch (err) {}
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    for (const integration of getAllIntegrations) {
      for (const toPost of body.posts) {
        const group = makeId(10);
        const randomDate = this.findTime(dates);

        await this.createPost(
          orgId,
          {
            type: 'draft',
            date: randomDate,
            order: '',
            shortLink: false,
            tags: [],
            posts: [
              {
                group,
                integration: {
                  id: integration.id,
                },
                settings: {
                  __type: integration.providerIdentifier as any,
                  title: '',
                  tags: [],
                  subreddit: [],
                },
                value: [
                  ...toPost.list.map((l) => ({
                    id: '',
                    content: l.post,
                    delay: 0,
                    image: [],
                  })),
                  {
                    id: '',
                    delay: 0,
                    content: `Check out the full story here:\n${
                      body.postId || body.url
                    }`,
                    image: [],
                  },
                ],
              },
            ],
          },
          'WEB'
        );
      }
    }
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const findTimes = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    return this.findFreeDateTimeRecursive(
      orgId,
      findTimes,
      dayjs.utc().startOf('day')
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs,
    depth = 0,
    maxDepth = 365
  ): Promise<string> {
    if (!times.length) {
      throw new BadRequestException(
        'No posting times configured for this organization'
      );
    }

    if (depth >= maxDepth) {
      throw new BadRequestException(
        'Unable to find a free publishing slot within the configured time window'
      );
    }

    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(
        orgId,
        times,
        date.add(1, 'day'),
        depth + 1,
        maxDepth
      );
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    return date.clone().add(num, 'minutes').format('YYYY-MM-DDTHH:mm:00');
  }

  /**
   * Pick a random time slot on one of the supplied draft dates.
   * Bounded so a week entirely in the past cannot recurse forever.
   */
  private findTime(dates: string[], maxAttempts = 1000): string {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const totalMinutes = Math.floor(randomInt(144)) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (!dayjs(randomDate).isBefore(dayjs())) {
        return randomDate;
      }
    }

    throw new BadRequestException(
      'Unable to find a future draft time in the selected week'
    );
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }

  async createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    // 4.1c: verify the post is in this org before writing an internal comment —
    // the repository createComment does not scope by org, so without this a
    // member could comment on another tenant's post by id.
    const post = await this.getPostById(postId, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }

  /**
   * Enforce the remaining POSTS_PER_MONTH quota for a batch that creates
   * `requestedCount` posts up front (e.g. bulk create), mirroring the
   * PermissionsService POSTS_PER_MONTH computation — which only fires once per
   * request, so a large batch would otherwise blow past the monthly cap.
   * No-op when billing is disabled (no STRIPE_PUBLISHABLE_KEY).
   */
  private async _enforcePostsBudget(orgId: string, requestedCount: number) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY || requestedCount <= 0) {
      return;
    }

    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(orgId);
    const tier = (subscription?.subscriptionTier ||
      'FREE') as keyof typeof pricing;
    const options = pricing[tier] || pricing.FREE;

    const anchor = subscription?.createdAt
      ? dayjs(subscription.createdAt)
      : dayjs().startOf('month');
    const totalMonthPast = Math.abs(anchor.diff(dayjs(), 'month'));
    const checkFrom = anchor.add(totalMonthPast, 'month');
    const used = await this._postRepository.countPostsFromDay(
      orgId,
      checkFrom.toDate()
    );

    if (used + requestedCount > options.posts_per_month) {
      throw new HttpException(
        {
          message: `Posts per month limit reached (${options.posts_per_month}). This request would create ${requestedCount} post(s).`,
        },
        HttpStatus.PAYMENT_REQUIRED
      );
    }
  }

  /**
   * Bulk-create posts from an array of simplified row DTOs. Each row is
   * validated independently; errors/warnings are returned per row without
   * failing the whole batch.
   */
  async bulkCreate(
    orgId: string,
    body: BulkCreatePostsDto,
  ): Promise<{ rows: Array<{ index: number; success: boolean; postId?: string; error?: string; warnings?: string[] }> }> {
    const results: Array<{ index: number; success: boolean; postId?: string; error?: string; warnings?: string[] }> = [];

    // Enforce the monthly quota against the whole request up front (rows ×
    // channels) — createPost's per-post gate is not re-checked in this loop.
    const requestedCount = (body.rows || []).reduce(
      (sum, r) => sum + (r.channels?.length || 0),
      0
    );
    await this._enforcePostsBudget(orgId, requestedCount);

    const integrations = await this._integrationService.getIntegrationsList(orgId);
    const activeIntegrations = integrations.filter((f) => !f.disabled && !f.deletedAt);

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const rowWarnings: string[] = [];
      let rowError: string | undefined;
      const postIds: string[] = [];

      // Reject scheduling in the past — a past date publishes immediately.
      if (row.scheduleAt && dayjs(row.scheduleAt).isBefore(dayjs())) {
        results.push({
          index: i,
          success: false,
          error: 'Cannot schedule a post in the past',
        });
        continue;
      }

      try {
        for (const channelId of row.channels) {
          const integration = activeIntegrations.find(
            (int) => int.id === channelId || int.providerIdentifier === channelId,
          );
          if (!integration) {
            rowWarnings.push(`Channel "${channelId}" not found or disabled — skipped`);
            continue;
          }

          try {
            const created = await this.createPost(orgId, {
              type: 'schedule',
              date: row.scheduleAt,
              order: '',
              shortLink: false,
              tags: [],
              campaignId: row.campaignId,
              posts: [
                {
                  group: `bulk-${Date.now()}-${i}`,
                  integration: { id: integration.id },
                  settings: { __type: integration.providerIdentifier as any } as any,
                  value: [{
                    id: '',
                    content: row.content,
                    delay: 0,
                    image: [],
                  }],
                },
              ],
            }, 'WEB');

            if (created?.length) {
              postIds.push(created[0].postId);
            }
          } catch (err: any) {
            rowWarnings.push(`Failed to create post for "${channelId}": ${err.message}`);
          }
        }
      } catch (err: any) {
        rowError = err.message;
      }

      results.push({
        index: i,
        success: !rowError && postIds.length > 0,
        postId: postIds[0],
        error: rowError,
        warnings: rowWarnings.length > 0 ? rowWarnings : undefined,
      });
    }

    return { rows: results };
  }

  getTotalCount(orgId: string) {
    return this._postRepository.getTotalPostCount(orgId);
  }

  getScheduledCount(orgId: string) {
    return this._postRepository.getScheduledPostCount(orgId);
  }

  getPublishedCountSince(orgId: string, since: Date) {
    return this._postRepository.getPublishedPostCountSince(orgId, since);
  }

  getDraftCount(orgId: string) {
    return this._postRepository.getDraftPostCount(orgId);
  }

  getUpcomingPosts(orgId: string, limit: number) {
    return this._postRepository.getUpcomingPosts(orgId, limit);
  }

  getFailedPosts(orgId: string, since: Date, limit: number) {
    return this._postRepository.getFailedPosts(orgId, since, limit);
  }

  getFailedPostCount(orgId: string, since: Date) {
    return this._postRepository.getFailedPostCount(orgId, since);
  }

  async getTopPosts(orgId: string, since: Date, limit: number) {
    const posts = await this._postRepository.getTopPosts(orgId, since, limit);
    return posts
      .map((p: any) => ({
        ...p,
        engagement: (p.lastViews || 0) + (p.lastLikes || 0) + (p.lastComments || 0),
      }))
      .sort((a: any, b: any) => b.engagement - a.engagement)
      .slice(0, limit);
  }

  getPendingApprovalPosts(orgId: string, limit: number) {
    return this._postRepository.getPendingApprovalPosts(orgId, limit);
  }

  getPendingApprovalPostCount(orgId: string) {
    return this._postRepository.getPendingApprovalPostCount(orgId);
  }

  async getSchedule(orgId: string, days: number, tz: string) {
    const safeTz = tz || 'UTC';
    const now = dayjs().tz(safeTz);
    const from = now.startOf('day').toDate();
    const to = now.add(days - 1, 'day').endOf('day').toDate();

    const [dates, trailingCount] = await Promise.all([
      this._postRepository.getScheduledPostDates(orgId, from, to),
      this._postRepository.countPostsFromDay(
        orgId,
        now.subtract(14, 'day').startOf('day').toDate()
      ),
    ]);

    const dayMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = now.add(i, 'day').format('YYYY-MM-DD');
      dayMap.set(d, 0);
    }

    for (const { publishDate } of dates) {
      const key = dayjs(publishDate).tz(safeTz).format('YYYY-MM-DD');
      if (dayMap.has(key)) {
        dayMap.set(key, dayMap.get(key)! + 1);
      }
    }

    const daysArray = Array.from(dayMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    const avg = trailingCount / 14;
    const gaps =
      avg >= 1
        ? daysArray.filter((d) => d.count === 0).map((d) => d.date)
        : [];

    return { days: daysArray, gaps };
  }

  async retryPost(orgId: string, postId: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.organizationId !== orgId) {
      throw new BadRequestException('Post not found');
    }

    if (post.state !== State.ERROR) {
      throw new BadRequestException('Post is not in an error state');
    }

    let publishDate = post.publishDate;
    if (dayjs(publishDate).isBefore(dayjs())) {
      publishDate = dayjs().add(1, 'minute').toDate();
    }

    await this._postRepository.retryPost(postId, orgId, publishDate);

    try {
      await this.startWorkflow(
        post.integration!.providerIdentifier,
        post.id,
        orgId,
        State.QUEUE,
        post.integration!.providerVersion ?? undefined
      );
    } catch (err) {
      Logger.warn(
        `Failed to re-emit post/publish for retried post ${postId}: ${
          (err as Error)?.message
        }`,
        PostsService.name
      );
    }

    return { success: true };
  }
}
