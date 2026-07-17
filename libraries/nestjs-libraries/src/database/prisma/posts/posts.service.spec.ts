import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.repository', () => ({
  PostsRepository: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository', () => ({
  AnalyticsRepository: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/file/file.service', () => ({
  FileService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/rag.service', () => ({
  RagService: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    jpeg: vi.fn().mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-jpeg-data')),
    }),
  }),
}));

vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: vi.fn(),
}));

import { PostsService } from './posts.service';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { State } from '@prisma/client';
import dayjs from 'dayjs';

describe('PostsService.enrichPostsWithLatestStats', () => {
  let service: PostsService;
  let analyticsRepository: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();

    analyticsRepository = {
      getLatestPostSnapshots: vi.fn().mockResolvedValue([]),
    };

    service = new PostsService(
      {} as any,
      analyticsRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  const publishedPost = (overrides: Record<string, any> = {}) => ({
    id: 'post-1',
    state: 'PUBLISHED',
    releaseId: 'release-abc',
    lastViews: null,
    lastLikes: null,
    lastComments: null,
    integration: { providerIdentifier: 'youtube' },
    ...overrides,
  });

  it('backfills lastViews/lastLikes/lastComments from snapshots', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([
      { postId: 'post-1', metric: 'views', value: 150 },
      { postId: 'post-1', metric: 'likes', value: 25 },
      { postId: 'post-1', metric: 'comments', value: 7 },
    ]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastViews).toBe(150);
    expect(posts[0].lastLikes).toBe(25);
    expect(posts[0].lastComments).toBe(7);
  });

  it('only takes the latest snapshot per metric (first seen = latest by desc date)', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([
      { postId: 'post-1', metric: 'views', value: 150 },
      { postId: 'post-1', metric: 'views', value: 100 },
    ]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastViews).toBe(150);
  });

  it('does not change post when no snapshot exists', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastViews).toBeNull();
    expect(posts[0].lastLikes).toBeNull();
    expect(posts[0].lastComments).toBeNull();
  });

  it('skips posts where lastViews/lastLikes/lastComments already have values', async () => {
    const posts = [publishedPost({ lastViews: 10, lastLikes: 2, lastComments: 1 })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();
  });

  it('skips non-PUBLISHED posts', async () => {
    const posts = [publishedPost({ state: 'DRAFT' })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();
  });

  it('skips posts with releaseId === "missing"', async () => {
    const posts = [publishedPost({ releaseId: 'missing' })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();
  });

  it('skips posts with null releaseId', async () => {
    const posts = [publishedPost({ releaseId: null })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();
  });

  it('never throws on snapshot query failure', async () => {
    analyticsRepository.getLatestPostSnapshots.mockRejectedValue(new Error('DB down'));

    const posts = [publishedPost()];
    await expect(
      service.enrichPostsWithLatestStats('org-1', posts)
    ).resolves.toBeUndefined();

    expect(posts[0].lastViews).toBeNull();
  });

  it('respects disableXAnalytics for X posts', async () => {
    const prev = process.env.DISABLE_X_ANALYTICS;
    process.env.DISABLE_X_ANALYTICS = 'true';

    const posts = [publishedPost({ integration: { providerIdentifier: 'x' } })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();

    process.env.DISABLE_X_ANALYTICS = prev;
  });

  it('enriches X posts when disableXAnalytics is not set', async () => {
    const prev = process.env.DISABLE_X_ANALYTICS;
    delete process.env.DISABLE_X_ANALYTICS;

    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([
      { postId: 'post-1', metric: 'likes', value: 50 },
    ]);

    const posts = [publishedPost({ integration: { providerIdentifier: 'x' } })];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastLikes).toBe(50);

    process.env.DISABLE_X_ANALYTICS = prev;
  });

  it('does nothing for empty posts array', async () => {
    await service.enrichPostsWithLatestStats('org-1', []);
    expect(analyticsRepository.getLatestPostSnapshots).not.toHaveBeenCalled();
  });

  // ── M4: Live-fallback tier for posts missing metrics after snapshot pass ──

  it('calls checkPostAnalytics for posts with no snapshot metrics (live fallback)', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);
    // Real AnalyticsData shape ({ label, data: [{ total, date }] }); provider 'youtube'
    // maps labels Views/Likes -> canonical views/likes via PROVIDER_METRIC_MAP.
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([
      { label: 'Views', data: [{ total: '200', date: '2026-06-09' }] },
      { label: 'Likes', data: [{ total: '30', date: '2026-06-09' }] },
    ]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(checkSpy).toHaveBeenCalledWith('org-1', 'post-1', expect.any(Number));
    expect(posts[0].lastViews).toBe(200);
    expect(posts[0].lastLikes).toBe(30);
    checkSpy.mockRestore();
  });

  it('picks the latest data point per metric in the live fallback', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([
      {
        label: 'Views',
        data: [
          { total: '100', date: '2026-06-07' },
          { total: '250', date: '2026-06-09' },
          { total: '180', date: '2026-06-08' },
        ],
      },
    ]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastViews).toBe(250);
    checkSpy.mockRestore();
  });

  it('ignores unmappable labels and non-numeric totals in the live fallback', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([
      { label: 'Some Unknown Metric', data: [{ total: '999', date: '2026-06-09' }] },
      { label: 'Views', data: [{ total: 'not-a-number', date: '2026-06-09' }] },
    ]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(posts[0].lastViews).toBeNull();
    checkSpy.mockRestore();
  });

  it('does not call live fallback when snapshot metrics are present', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([
      { postId: 'post-1', metric: 'views', value: 150 },
      { postId: 'post-1', metric: 'likes', value: 25 },
    ]);
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(checkSpy).not.toHaveBeenCalled();
    checkSpy.mockRestore();
  });

  it('skips live fallback for posts that have any snapshot metric (not fully missing)', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([
      { postId: 'post-1', metric: 'views', value: 100 },
    ]);
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([]);

    const posts = [publishedPost()];
    await service.enrichPostsWithLatestStats('org-1', posts);

    // views came from snapshot; post has a metric present so live fallback is skipped
    expect(posts[0].lastViews).toBe(100);
    expect(checkSpy).not.toHaveBeenCalled();
    checkSpy.mockRestore();
  });

  it('caps live fallback fan-out at 10 posts', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockResolvedValue([]);

    const posts = Array.from({ length: 15 }, (_, i) => publishedPost({ id: `post-${i + 10}` }));
    await service.enrichPostsWithLatestStats('org-1', posts);

    expect(checkSpy).toHaveBeenCalledTimes(10);
    checkSpy.mockRestore();
  });

  it('does not reject batch when a single live fallback throws', async () => {
    analyticsRepository.getLatestPostSnapshots.mockResolvedValue([]);
    let callCount = 0;
    const checkSpy = vi.spyOn(service as any, 'checkPostAnalytics').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('API down');
      return [{ label: 'Views', data: [{ total: '50', date: '2026-06-09' }] }];
    });

    const posts = [
      publishedPost({ id: 'post-fail' }),
      publishedPost({ id: 'post-ok' }),
    ];
    await expect(service.enrichPostsWithLatestStats('org-1', posts)).resolves.toBeUndefined();
    // The second post should still get enriched
    expect(posts[1].lastViews).toBe(50);
    checkSpy.mockRestore();
  });
});

describe('PostsService.updateMedia', () => {
  let service: PostsService;
  let storageServiceMock: { getLocalAdapterForOrg: ReturnType<typeof vi.fn> };
  let postRepositoryMock: { updateImages: ReturnType<typeof vi.fn> };
  let mockAdapter: { uploadFile: ReturnType<typeof vi.fn> };

  const pngImageItem = (overrides: Record<string, any> = {}) => ({
    path: '/local/images/test.png',
    ...overrides,
  });

  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();

    mockAdapter = {
      uploadFile: vi.fn().mockResolvedValue({
        path: '/uploads/test.jpg',
        originalname: 'test.jpg',
      }),
    };

    storageServiceMock = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue(mockAdapter),
    };

    postRepositoryMock = {
      updateImages: vi.fn().mockResolvedValue(undefined),
    };

    process.env.UPLOAD_DIRECTORY = '/uploads';
    process.env.FRONTEND_URL = 'http://localhost:4200';
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'static';

    vi.mocked(hasExtension).mockReturnValue(true);
    vi.mocked(readOrFetch).mockResolvedValue(Buffer.from('mock-png-data'));

    service = new PostsService(
      postRepositoryMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      storageServiceMock as any,
    );
  });

  afterEach(() => {
    delete process.env.UPLOAD_DIRECTORY;
    delete process.env.FRONTEND_URL;
    delete process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;
  });

  it('calls getLocalAdapterForOrg when orgId is provided and convertToJPEG is true for a PNG image', async () => {
    const imagesList = [pngImageItem()];

    await service.updateMedia('post-123', imagesList, true, 'org-42');

    expect(storageServiceMock.getLocalAdapterForOrg).toHaveBeenCalledWith('org-42', true);
    expect(mockAdapter.uploadFile).toHaveBeenCalled();
    expect(postRepositoryMock.updateImages).toHaveBeenCalled();
  });

  it('does not call getLocalAdapterForOrg when convertToJPEG is false', async () => {
    const imagesList = [pngImageItem()];

    await service.updateMedia('post-123', imagesList, false, 'org-42');

    expect(storageServiceMock.getLocalAdapterForOrg).not.toHaveBeenCalled();
  });
});

describe('PostsService Inngest dispatch', () => {
  let service: PostsService;
  let postRepositoryMock: { deletePost: ReturnType<typeof vi.fn> };
  let integrationManagerMock: {
    getSocialIntegrationUnchecked: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);

    postRepositoryMock = {
      deletePost: vi.fn().mockResolvedValue({ id: 'post-123' }),
    };

    integrationManagerMock = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue({
        maxConcurrentJob: 3,
      }),
    };

    service = new PostsService(
      postRepositoryMock as any,
      {} as any,
      integrationManagerMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  it('deletePost emits post/cancel with the deleted post id', async () => {
    await service.deletePost('org-1', 'group-1');

    expect(postRepositoryMock.deletePost).toHaveBeenCalledWith('org-1', 'group-1');
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'post/cancel',
      data: { postId: 'post-123' },
    });
  });

  it('deletePost swallows inngest.send errors and still returns error:true', async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error('Inngest down'));

    const result = await service.deletePost('org-1', 'group-1');

    expect(inngest.send).toHaveBeenCalled();
    expect(result).toEqual({ error: true });
  });

  it('startWorkflow emits post/publish with a unique-per-send id and current payload fields', async () => {
    await service.startWorkflow('youtube', 'post-456', 'org-2', 'QUEUE' as State);

    const publish = vi
      .mocked(inngest.send)
      .mock.calls.map((c) => c[0] as any)
      .find((e) => e.name === 'post/publish');

    expect(publish).toMatchObject({
      name: 'post/publish',
      data: {
        postId: 'post-456',
        organizationId: 'org-2',
        taskQueue: 'youtube',
        maxConcurrentJob: 3,
      },
    });
    // Unique-per-send id (no longer the constant `post_${postId}`).
    expect(publish.id).toMatch(/^post_post-456_/);
  });

  it('startWorkflow emits post/cancel before post/publish', async () => {
    await service.startWorkflow('linkedin', 'post-789', 'org-3', 'QUEUE' as State);

    expect(inngest.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(inngest.send).mock.calls[0][0]).toMatchObject({
      name: 'post/cancel',
      data: { postId: 'post-789' },
    });
    expect(vi.mocked(inngest.send).mock.calls[1][0]).toMatchObject({
      name: 'post/publish',
      data: { postId: 'post-789', taskQueue: 'linkedin', maxConcurrentJob: 3 },
    });
  });

  it('startWorkflow returns early for DRAFT state after sending cancel', async () => {
    await service.startWorkflow('youtube', 'post-draft', 'org-4', 'DRAFT' as State);

    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'post/cancel',
      data: { postId: 'post-draft' },
    });
  });

  it('deletePost skips inngest.send when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);

    await service.deletePost('org-1', 'group-1');

    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('startWorkflow skips all events when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);

    await service.startWorkflow('youtube', 'post-456', 'org-2', 'QUEUE' as State);

    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('startWorkflow resolves taskQueue from providerIdentifier.split("-")[0]', async () => {
    integrationManagerMock.getSocialIntegrationUnchecked.mockReturnValue({
      maxConcurrentJob: 2,
    });

    await service.startWorkflow('linkedin-page', 'post-page', 'org-5', 'QUEUE' as State);

    expect(integrationManagerMock.getSocialIntegrationUnchecked).toHaveBeenCalledWith(
      'linkedin-page',
      undefined
    );
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'post/publish',
        data: expect.objectContaining({
          taskQueue: 'linkedin',
          maxConcurrentJob: 2,
        }),
      })
    );
  });

  it('startWorkflow defaults maxConcurrentJob to 1 when provider is not found', async () => {
    integrationManagerMock.getSocialIntegrationUnchecked.mockReturnValue(undefined);

    await service.startWorkflow('unknown-provider', 'post-unknown', 'org-6', 'QUEUE' as State);

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'post/publish',
        data: expect.objectContaining({
          taskQueue: 'unknown',
          maxConcurrentJob: 1,
        }),
      })
    );
  });

  it('PV-09 regression: startWorkflow resolves the pinned provider version', async () => {
    integrationManagerMock.getSocialIntegrationUnchecked.mockImplementation(
      (_id: string, version?: string) =>
        version === 'v1'
          ? { maxConcurrentJob: 7 }
          : { maxConcurrentJob: 99 }
    );

    await service.startWorkflow('x', 'post-v1', 'org-7', 'QUEUE' as State, 'v1');

    expect(integrationManagerMock.getSocialIntegrationUnchecked).toHaveBeenCalledWith(
      'x',
      'v1'
    );
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'post/publish',
        data: expect.objectContaining({
          maxConcurrentJob: 7,
        }),
      })
    );
  });
});

// ── POSTS_REMEDIATION tasks 0.5, 0.8, 1.2, 1.5, 1.6, 1.7, 4.1b, 4.4e ──

function makePostsService(overrides: Record<string, any> = {}) {
  const postRepository = {
    getPost: vi.fn(),
    getPostById: vi.fn(),
    getPostsByGroup: vi.fn(),
    changeState: vi.fn().mockResolvedValue(undefined),
    changeDate: vi.fn().mockResolvedValue({ date: '2030-01-01' }),
    countPostsFromDay: vi.fn().mockResolvedValue(0),
    getScheduledPostDates: vi.fn().mockResolvedValue([]),
    getPostsCountsByDates: vi.fn().mockResolvedValue([]),
    retryPost: vi.fn().mockResolvedValue({}),
    ...overrides.postRepository,
  };
  const integrationManager = {
    getSocialIntegrationUnchecked: vi.fn().mockReturnValue({ maxConcurrentJob: 1 }),
  };
  const integrationService = {
    getIntegrationsList: vi.fn().mockResolvedValue([]),
    ...overrides.integrationService,
  };
  const shortLinkService = {
    shouldShortlink: vi.fn().mockResolvedValue({ ask: false, domain: undefined }),
    ...overrides.shortLinkService,
  };
  const campaignsRepository = {
    findById: vi.fn(),
    ...overrides.campaignsRepository,
  };
  const subscriptionService = {
    getSubscriptionByOrganizationId: vi.fn().mockResolvedValue(null),
    ...overrides.subscriptionService,
  };

  const service = new PostsService(
    postRepository as any, // _postRepository
    {} as any, // _analyticsRepository
    integrationManager as any, // _integrationManager
    integrationService as any, // _integrationService
    {} as any, // _fileService
    shortLinkService as any, // _shortLinkService
    {} as any, // _openaiService
    {} as any, // _refreshIntegrationService
    {} as any, // _ragService
    {} as any, // _storageService
    campaignsRepository as any, // _campaignsRepository
    {} as any, // _auditService
    subscriptionService as any, // _subscriptionService
  );

  return { service, postRepository, integrationService, shortLinkService, campaignsRepository, subscriptionService };
}

describe('0.5 — strip decrypted integration secrets from HTTP reads', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
  });

  it('getPost result has no token/refreshToken on integration', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPost.mockResolvedValue({
      id: 'p1',
      group: 'g1',
      image: '[]',
      settings: '{}',
      integrationId: 'int-1',
      integration: {
        id: 'int-1',
        providerIdentifier: 'x',
        name: 'My X',
        picture: 'pic.png',
        profile: 'handle',
        token: 'SECRET_TOKEN',
        refreshToken: 'SECRET_REFRESH',
        customInstanceDetails: 'SECRET_INSTANCE',
      },
      childrenPost: [],
    });

    const result = await service.getPost('org-1', 'p1');
    const integration = (result.posts[0] as any).integration;

    expect(integration.token).toBeUndefined();
    expect(integration.refreshToken).toBeUndefined();
    expect(integration.customInstanceDetails).toBeUndefined();
    expect(integration.id).toBe('int-1');
    expect(integration.providerIdentifier).toBe('x');
    expect(integration.name).toBe('My X');
    expect(integration.picture).toBe('pic.png');
    expect(integration.profile).toBe('handle');
  });
});

describe('0.8 / 4.4e — unique publish event id + inngest-disabled warning', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);
    (PostsService as any)._inngestDisabledWarned = false;
  });

  it('emits a post/publish id matching /^post_.*_/ that differs between two sends', async () => {
    const { service } = makePostsService();

    await service.startWorkflow('x', 'post-123', 'org-1', 'QUEUE' as State);
    await service.startWorkflow('x', 'post-123', 'org-1', 'QUEUE' as State);

    const publishSends = vi
      .mocked(inngest.send)
      .mock.calls.map((c) => c[0] as any)
      .filter((e) => e.name === 'post/publish');

    expect(publishSends).toHaveLength(2);
    expect(publishSends[0].id).toMatch(/^post_.*_/);
    expect(publishSends[1].id).toMatch(/^post_.*_/);
    expect(publishSends[0].id).not.toBe(publishSends[1].id);
  });

  it('4.4e — warns once when USE_INNGEST is disabled and sends nothing', async () => {
    const { service } = makePostsService();
    vi.mocked(isInngestEnabled).mockReturnValue(false);
    const { Logger } = await import('@nestjs/common');
    const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    await service.startWorkflow('x', 'post-1', 'org-1', 'QUEUE' as State);
    await service.startWorkflow('x', 'post-2', 'org-1', 'QUEUE' as State);

    const inngestWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('USE_INNGEST'));
    expect(inngestWarns).toHaveLength(1);
    expect(inngest.send).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('1.2 — changePostStatus approval gate', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);
  });

  it('rejects promoting a pending campaign draft to schedule', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPostById.mockResolvedValue({
      id: 'p1',
      campaignId: 'camp-1',
      approvalStatus: 'pending',
      integration: { providerIdentifier: 'x' },
    });

    await expect(service.changePostStatus('org-1', 'p1', 'schedule')).rejects.toThrow(
      'Draft not approved',
    );
    expect(postRepository.changeState).not.toHaveBeenCalled();
  });

  it('allows promoting an approved campaign draft', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPostById.mockResolvedValue({
      id: 'p1',
      campaignId: 'camp-1',
      approvalStatus: 'approved',
      integration: { providerIdentifier: 'x' },
    });

    await expect(service.changePostStatus('org-1', 'p1', 'schedule')).resolves.toEqual({
      id: 'p1',
      state: 'QUEUE',
    });
    // 4.4a — org id is now threaded through the publish-path mutators
    expect(postRepository.changeState).toHaveBeenCalledWith('p1', 'QUEUE', 'org-1');
  });
});

describe('1.5 — bulkCreate enforces remaining POSTS_PER_MONTH budget', () => {
  const prev = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = prev;
  });

  it('rejects a bulk request (402) when the org is at its monthly cap', async () => {
    const { service } = makePostsService({
      subscriptionService: {
        getSubscriptionByOrganizationId: vi
          .fn()
          .mockResolvedValue({ subscriptionTier: 'STARTER', createdAt: new Date() }), // 100/mo
      },
      postRepository: {
        countPostsFromDay: vi.fn().mockResolvedValue(400),
      },
    });

    await expect(
      service.bulkCreate('org-1', {
        rows: [
          {
            content: 'hello',
            channels: ['int-1'],
            scheduleAt: '2999-01-01T00:00:00.000Z',
          } as any,
        ],
      } as any),
    ).rejects.toMatchObject({ status: 402 });
  });
});

describe('1.6 — UTM not applied to already-shortened URLs', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
  });

  it('leaves a short-domain URL untouched and applies UTM to raw URLs', async () => {
    const { service } = makePostsService({
      shortLinkService: {
        shouldShortlink: vi.fn().mockResolvedValue({ ask: false, domain: 'short.io' }),
      },
      campaignsRepository: {
        findById: vi.fn().mockResolvedValue({ utmEnabled: true, name: 'My Campaign' }),
      },
    });

    const [out] = await (service as any)._appendUtmToMessages(
      ['Read https://short.io/abc and https://example.com/page.'],
      'camp-1',
      'org-1',
      'x',
    );

    expect(out).toContain('https://short.io/abc');
    expect(out).not.toContain('short.io/abc?');
    expect(out).not.toContain('short.io/abc&');
    expect(out).toContain('utm_campaign=my-campaign');
    // Raw URL tagged; trailing '.' preserved outside the query string.
    expect(out).toMatch(/example\.com\/page\?utm_campaign=my-campaign[^.\s]*\.$/);
  });
});

describe('1.7 — reject scheduling in the past', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
  });

  it('validateAndCreatePost rejects a schedule with a past date', async () => {
    const { service } = makePostsService();
    const past = '2000-01-01T00:00:00.000Z';
    vi.spyOn(service, 'mapTypeToPost').mockResolvedValue({
      type: 'schedule',
      date: past,
      posts: [],
    } as any);

    await expect(
      service.validateAndCreatePost('org-1', { type: 'schedule', date: past }, 'WEB' as any),
    ).rejects.toThrow('Cannot schedule a post in the past');
  });
});

describe('4.1b — changeDate guards', () => {
  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);
  });

  it('throws Post not found for an unknown id', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPostById.mockResolvedValue(null);

    await expect(service.changeDate('org-1', 'nope', '2030-01-01', 'schedule')).rejects.toThrow(
      'Post not found',
    );
  });

  it('does not re-queue an already-published post on reschedule', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPostById.mockResolvedValue({
      id: 'p1',
      state: 'PUBLISHED',
      integration: { providerIdentifier: 'x' },
    });
    const startSpy = vi.spyOn(service, 'startWorkflow').mockResolvedValue(undefined);

    await service.changeDate('org-1', 'p1', '2030-01-01', 'schedule');

    expect(postRepository.changeDate).toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });
});

describe('1.4 — schedule-per-day counts + gap suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns day counts and gaps for empty days when org posts >=1/day', async () => {
    const { service, postRepository } = makePostsService({
      postRepository: {
        getScheduledPostDates: vi.fn().mockResolvedValue([
          { publishDate: new Date('2026-06-11T10:00:00.000Z') },
          { publishDate: new Date('2026-06-12T10:00:00.000Z') },
          { publishDate: new Date('2026-06-15T10:00:00.000Z') },
        ]),
        countPostsFromDay: vi.fn().mockResolvedValue(14),
      },
    });

    const result = await service.getSchedule('org-1', 7, 'UTC');

    expect(result.days.map((d: any) => d.count)).toEqual([1, 1, 0, 0, 1, 0, 0]);
    expect(result.gaps).toEqual(['2026-06-13', '2026-06-14', '2026-06-16', '2026-06-17']);
  });

  it('suppresses gaps for low-volume orgs', async () => {
    const { service, postRepository } = makePostsService({
      postRepository: {
        getScheduledPostDates: vi.fn().mockResolvedValue([]),
        countPostsFromDay: vi.fn().mockResolvedValue(7),
      },
    });

    const result = await service.getSchedule('org-1', 7, 'UTC');
    expect(result.gaps).toEqual([]);
  });
});

describe('1.2 — retry post', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.mocked(inngest.send).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets ERROR post to QUEUE and re-emits publish', async () => {
    const { service, postRepository } = makePostsService({
      postRepository: {
        getPostById: vi.fn().mockResolvedValue({
          id: 'p1',
          organizationId: 'org-1',
          state: 'ERROR',
          publishDate: new Date('2026-06-11T10:00:00.000Z'),
          integration: { providerIdentifier: 'x', providerVersion: 'v1' },
        }),
      },
    });
    const startSpy = vi.spyOn(service, 'startWorkflow').mockResolvedValue(undefined);

    await service.retryPost('org-1', 'p1');

    expect(postRepository.retryPost).toHaveBeenCalledWith(
      'p1',
      'org-1',
      expect.any(Date),
    );
    expect(startSpy).toHaveBeenCalledWith('x', 'p1', 'org-1', State.QUEUE, 'v1');
  });

  it('rejects non-ERROR posts', async () => {
    const { service, postRepository } = makePostsService({
      postRepository: {
        getPostById: vi.fn().mockResolvedValue({
          id: 'p1',
          organizationId: 'org-1',
          state: 'PUBLISHED',
          integration: { providerIdentifier: 'x' },
        }),
      },
    });

    await expect(service.retryPost('org-1', 'p1')).rejects.toThrow('not in an error state');
  });
});


describe('POLL-11 — cap draft scheduling loops', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('findTime terminates with an error when every draft date is in the past', async () => {
    const { service } = makePostsService({
      integrationService: {
        getIntegrationsList: vi.fn().mockResolvedValue([
          {
            id: 'int-1',
            providerIdentifier: 'linkedin',
            disabled: false,
          },
        ]),
      },
    });

    await expect(
      service.generatePostsDraft('org-1', {
        week: 1,
        year: 2000,
        url: 'https://example.com',
        posts: [{ list: [{ post: 'hello' }] }],
      } as any)
    ).rejects.toThrow('Unable to find a future draft time in the selected week');
  });

  it('findFreeDateTimeRecursive terminates with an error after exhausting the search window', async () => {
    const { service, postRepository } = makePostsService();
    postRepository.getPostsCountsByDates.mockResolvedValue([]);

    await expect(
      (service as any).findFreeDateTimeRecursive(
        'org-1',
        [60, 120],
        dayjs.utc().startOf('day'),
        0,
        3
      )
    ).rejects.toThrow(
      'Unable to find a free publishing slot within the configured time window'
    );

    expect(postRepository.getPostsCountsByDates).toHaveBeenCalledTimes(3);
  });

  it('findFreeDateTimeRecursive rejects an empty posting-times list immediately', async () => {
    const { service, postRepository } = makePostsService();

    await expect(
      (service as any).findFreeDateTimeRecursive(
        'org-1',
        [],
        dayjs.utc().startOf('day')
      )
    ).rejects.toThrow('No posting times configured for this organization');

    expect(postRepository.getPostsCountsByDates).not.toHaveBeenCalled();
  });
});
