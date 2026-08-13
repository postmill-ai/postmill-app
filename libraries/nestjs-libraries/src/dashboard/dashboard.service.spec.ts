import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService, DashboardSummaryResponse } from './dashboard.service';
import { PostsService } from '@postmill-ai/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { SocialCommentsService } from '@postmill-ai/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrgAiSettingsService } from '@postmill-ai/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { AiMediaService } from '@postmill-ai/nestjs-libraries/ai/governance/media.service';
import { StorageService } from '@postmill-ai/nestjs-libraries/database/prisma/storage/storage.service';
import { RedisService } from '@postmill-ai/nestjs-libraries/redis/redis.service';
import { pricing } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';

const org = { id: 'org-1', timezone: 'UTC' } as any;
const user = { id: 'user-1' } as any;

function buildService(overrides: {
  redis?: Partial<RedisService>;
  posts?: Partial<PostsService>;
} = {}) {
  const postsService = {
    getTotalCount: vi.fn().mockResolvedValue(12),
    getScheduledCount: vi.fn().mockResolvedValue(3),
    getPublishedCountSince: vi.fn().mockResolvedValue(5),
    getDraftCount: vi.fn().mockResolvedValue(2),
    getUpcomingPosts: vi.fn().mockResolvedValue([
      {
        id: 'post-1',
        content: 'Hello world',
        publishDate: new Date('2026-06-11T10:00:00.000Z'),
        integration: { name: 'My X', providerIdentifier: 'x' },
      },
    ]),
    getFailedPosts: vi.fn().mockResolvedValue([]),
    getFailedPostCount: vi.fn().mockResolvedValue(0),
    getPendingApprovalPostCount: vi.fn().mockResolvedValue(0),
    getSchedule: vi.fn().mockResolvedValue({ days: [], gaps: [] }),
    countPostsFromDay: vi.fn().mockResolvedValue(12),
    ...overrides.posts,
  } as unknown as PostsService;

  const integrationService = {
    getIntegrationsList: vi.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]),
  } as unknown as IntegrationService;

  const socialCommentsService = {
    getInboxUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 4 }),
  } as unknown as SocialCommentsService;

  const organizationService = {
    getTeam: vi.fn().mockResolvedValue({ users: [{}, {}, {}] }),
  } as unknown as OrganizationService;

  const orgAiSettingsService = {
    getActiveProvider: vi.fn().mockResolvedValue({ identifier: 'openai' }),
  } as unknown as OrgAiSettingsService;

  const aiMediaService = {
    getMediaProviderSummary: vi
      .fn()
      .mockResolvedValue([{ available: false }, { available: true }]),
  } as unknown as AiMediaService;

  const storageService = {
    getProviderConfigs: vi.fn().mockResolvedValue([]),
  } as unknown as StorageService;

  const redisService = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides.redis,
  } as unknown as RedisService;

  const aiSettingsService = {
    getMediaJobsWithCounts: vi.fn().mockResolvedValue({ jobs: [], counts: { pending: 0, processing: 0, failed7d: 0 } }),
    getSpendSummary: vi.fn().mockResolvedValue([]),
  } as any;

  const campaignsService = {
    getSummaries: vi.fn().mockResolvedValue([]),
  } as any;

  const analyticsService = {
    listAnomalies: vi.fn().mockResolvedValue([]),
  } as any;

  const aiSettingsManager = {
    getSettings: vi.fn().mockResolvedValue({}),
    getSpendSummary: vi.fn().mockResolvedValue([]),
  } as any;

  const subscriptionService = {
    getCreditsFrom: vi.fn().mockResolvedValue(3),
  } as any;

  const fileRepository = {
    getStorageBytes: vi.fn().mockResolvedValue(1024 * 1024),
    getFilesByPaths: vi.fn().mockResolvedValue([]),
  } as any;

  const webhooksService = {
    getTotal: vi.fn().mockResolvedValue(7),
  } as any;

  const brandsRepository = {
    countBrands: vi.fn().mockResolvedValue(4),
  } as any;

  const watchlistRepository = {
    countByOrg: vi.fn().mockResolvedValue(6),
  } as any;

  const service = new DashboardService(
    postsService,
    integrationService,
    socialCommentsService,
    organizationService,
    orgAiSettingsService,
    aiMediaService,
    storageService,
    aiSettingsService,
    campaignsService,
    analyticsService,
    aiSettingsManager,
    redisService,
    subscriptionService,
    fileRepository,
    webhooksService,
    brandsRepository,
    watchlistRepository,
  );

  return {
    service,
    postsService,
    integrationService,
    socialCommentsService,
    organizationService,
    orgAiSettingsService,
    aiMediaService,
    storageService,
    aiSettingsService,
    campaignsService,
    analyticsService,
    aiSettingsManager,
    redisService,
    fileRepository,
    webhooksService,
    brandsRepository,
    watchlistRepository,
  };
}

describe('DashboardService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assembles the summary from domain services', async () => {
    const { service } = buildService();
    const result = await service.getSummary(org, user);

    expect(result.totalPosts).toBe(12);
    expect(result.scheduledPosts).toBe(3);
    expect(result.publishedNext7).toBe(5);
    expect(result.channelsConnected).toBe(2);
    expect(result.drafts).toBe(2);
    expect(result.commentUnreadCount).toBe(4);
    expect(result.aiProviderActive).toBe(true);
    expect(result.mediaProviderActive).toBe(true);
    expect(result.storageProviderActive).toBe(false);
    expect(result.teamMembers).toBe(3);
    expect(result.upcomingPosts).toHaveLength(1);
  });

  it('returns cached summary without invoking domain services', async () => {
    const cached: DashboardSummaryResponse = {
      totalPosts: 99,
      scheduledPosts: 0,
      publishedNext7: 0,
      channelsConnected: 0,
      drafts: 0,
      upcomingPosts: [],
      commentUnreadCount: 0,
      aiProviderActive: false,
      mediaProviderActive: false,
      storageProviderActive: false,
      teamMembers: 0,
    };

    const { service, postsService, redisService } = buildService({
      redis: { get: vi.fn().mockResolvedValue(JSON.stringify(cached)) },
    });

    const result = await service.getSummary(org, user);
    expect(result).toEqual(cached);
    expect(postsService.getTotalCount).not.toHaveBeenCalled();
    expect(redisService.get).toHaveBeenCalledWith(
      `dashboard:summary:${org.id}:${user.id}`,
    );
  });

  it('writes the computed summary to Redis with a 60s TTL', async () => {
    const { service, redisService } = buildService();
    await service.getSummary(org, user);

    expect(redisService.set).toHaveBeenCalledWith(
      `dashboard:summary:${org.id}:${user.id}`,
      expect.any(String),
      60,
    );
  });

  it('single-flights concurrent cache misses', async () => {
    const { service, postsService } = buildService();
    const [a, b] = await Promise.all([
      service.getSummary(org, user),
      service.getSummary(org, user),
    ]);

    expect(a).toEqual(b);
    // The underlying count services should only be invoked once across both calls.
    expect(postsService.getTotalCount).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardService.getAttention', () => {
  const allKinds: any = [
    'failed-posts',
    'channel-health',
    'pending-approvals',
    'unread-comments',
    'schedule-gaps',
    'budget',
    'failed-media-jobs',
    'anomalies',
  ];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns items for every fired probe, sorted by severity', async () => {
    const { service, postsService, integrationService, socialCommentsService, aiSettingsService, analyticsService } = buildService({
      posts: {
        getFailedPosts: vi.fn().mockResolvedValue([{ id: 'p1', content: 'x' }]),
        getFailedPostCount: vi.fn().mockResolvedValue(1),
        getPendingApprovalPostCount: vi.fn().mockResolvedValue(2),
        getSchedule: vi.fn().mockResolvedValue({ days: [], gaps: ['2026-06-13'] }),
      },
    });
    integrationService.getHealthSummary = vi.fn().mockResolvedValue([{ id: 'i1' }]);
    socialCommentsService.getInboxUnreadCount = vi.fn().mockResolvedValue({ unreadCount: 3 });
    aiSettingsService.getMediaJobsWithCounts = vi.fn().mockResolvedValue({ jobs: [], counts: { failed7d: 1 } });
    analyticsService.listAnomalies = vi.fn().mockResolvedValue([{ id: 'a1', title: 'Drop' }]);

    const result = await service.getAttention('org-1', 'user-1', allKinds, {
      postsThisCycle: 900,
      postsLimit: 1000,
      channels: 1,
      channelsLimit: 10,
      teamMembers: 1,
      teamLimit: 5,
    }, 'UTC');

    const kinds = result.items.map((i) => i.kind);
    expect(kinds).toContain('failed-posts');
    expect(kinds).toContain('channel-health');
    expect(kinds).toContain('pending-approvals');
    expect(kinds).toContain('unread-comments');
    expect(kinds).toContain('schedule-gaps');
    expect(kinds).toContain('failed-media-jobs');
    expect(kinds).toContain('anomalies');

    // critical items first
    expect(result.items[0].severity).toBe('critical');
  });

  it('links every attention item at a page that shows the problem', async () => {
    const { service, postsService, integrationService, socialCommentsService, aiSettingsService } =
      buildService({
        posts: {
          getFailedPosts: vi.fn().mockResolvedValue([{ id: 'p1' }]),
          getPendingApprovals: vi.fn().mockResolvedValue([{ id: 'p2' }]),
          getSchedule: vi.fn().mockResolvedValue({ days: [], gaps: ['2026-06-13'] }),
        },
      });
    integrationService.getHealthSummary = vi.fn().mockResolvedValue([{ id: 'i1' }]);
    socialCommentsService.getInboxUnreadCount = vi.fn().mockResolvedValue({ unreadCount: 3 });
    aiSettingsService.getMediaJobsWithCounts = vi
      .fn()
      .mockResolvedValue({ jobs: [], counts: { failed7d: 1 } });

    const result = await service.getAttention('org-1', 'user-1', allKinds, {
      postsThisCycle: 900,
      postsLimit: 1000,
      channels: 1,
      channelsLimit: 10,
      teamMembers: 1,
      teamLimit: 5,
    }, 'UTC');
    const linkFor = (kind: string) => result.items.find((i) => i.kind === kind)?.link;

    // Failures live in the queue, not the studio index.
    expect(linkFor('failed-media-jobs')).toBe('/media/queue?status=failed');
    // /billing sells plans and shows no usage; the analytics Usage tab shows both halves.
    expect(linkFor('budget')).toBe('/analytics?tab=usage');
    // Canonical path — the `?tab=` form goes through a client-side redirect shim.
    expect(linkFor('channel-health')).toBe('/settings/channels');
    expect(postsService.getFailedPosts).toHaveBeenCalled();
  });

  it('never computes forbidden probes', async () => {
    const { service, postsService, integrationService } = buildService();
    integrationService.getHealthSummary = vi.fn().mockResolvedValue([]);

    await service.getAttention('org-1', 'user-1', ['unread-comments']);

    expect(postsService.getFailedPosts).not.toHaveBeenCalled();
    expect(integrationService.getHealthSummary).not.toHaveBeenCalled();
  });

  it('caches and single-flights attention', async () => {
    const { service, postsService, redisService } = buildService({
      posts: {
        getFailedPostCount: vi.fn().mockResolvedValue(0),
        getPendingApprovalPostCount: vi.fn().mockResolvedValue(0),
        getSchedule: vi.fn().mockResolvedValue({ days: [], gaps: [] }),
      },
    });

    await Promise.all([
      service.getAttention('org-1', 'user-1', []),
      service.getAttention('org-1', 'user-1', []),
    ]);

    expect(redisService.set).toHaveBeenCalledWith(
      `dashboard:attention:org-1:user-1`,
      expect.any(String),
      60,
    );
  });
});

describe('DashboardService.getSchedule', () => {
  it('delegates to PostsService.getSchedule with org timezone', async () => {
    const { service, postsService } = buildService();
    postsService.getSchedule = vi
      .fn()
      .mockResolvedValue({ days: [{ date: '2026-06-11', count: 2 }], gaps: [] });

    const result = await service.getSchedule('org-1', 7, 'America/New_York');

    expect(postsService.getSchedule).toHaveBeenCalledWith(
      'org-1',
      7,
      'America/New_York',
    );
    expect(result.days).toHaveLength(1);
  });
});

describe('DashboardService.getCampaignSummaries', () => {
  it('delegates to CampaignsService.getSummaries with the supplied limit', async () => {
    const { service, campaignsService } = buildService();
    const summaries = [{ id: 'c1', name: 'Launch' }];
    campaignsService.getSummaries = vi.fn().mockResolvedValue(summaries);

    const result = await service.getCampaignSummaries('org-1', 4);

    expect(campaignsService.getSummaries).toHaveBeenCalledWith('org-1', 4);
    expect(result).toEqual(summaries);
  });
});

describe('DashboardService.getMediaJobs', () => {
  it('returns mapped jobs and counts from AiSettingsService', async () => {
    const { service, aiSettingsService } = buildService();
    aiSettingsService.getMediaJobsWithCounts = vi.fn().mockResolvedValue({
      jobs: [
        {
          id: 'j1',
          provider: 'runway',
          operation: 'video',
          status: 'completed',
          artifactUrl: 'https://example.com/v.mp4',
          error: null,
          createdAt: '2026-06-11T10:00:00Z',
        },
      ],
      counts: { pending: 0, processing: 0, failed7d: 1 },
    });

    const result = await service.getMediaJobs('org-1');

    // Bare call = the dashboard widget's original 20-job payload; every filter
    // stays undefined so the repository query is unchanged.
    expect(aiSettingsService.getMediaJobsWithCounts).toHaveBeenCalledWith('org-1', 20, {
      status: undefined,
      provider: undefined,
      cursor: undefined,
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].provider).toBe('runway');
    expect(result.counts.failed7d).toBe(1);
  });
});

describe('DashboardService.buildUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assembles usage payload from domain services', async () => {
    const { service } = buildService();
    const result = await service.buildUsage(
      org,
      { subscriptionTier: 'PRO', createdAt: new Date('2024-01-01') },
      {
        posts_per_month: 1000,
        channel: 12,
        team_members: 5,
        storage_gb: 5,
        video_exports: 60,
        competitors: 5,
        webhooks: 5,
        brand_kits: 2,
      },
      false
    );

    expect(result.billingEnabled).toBe(true);
    expect(result.tier).toBe('PRO');
    expect(result.limits.channels).toBe(12);
    expect(result.limits.competitors).toBe(5);
    expect(result.limits.webhooks).toBe(5);
    expect(result.limits.brandKits).toBe(2);
    expect(result.usage.postsThisCycle).toBe(12);
    expect(result.usage.channels).toBe(2);
    expect(result.usage.teamMembers).toBe(3);
    expect(result.usage.competitors).toBe(6);
    expect(result.usage.webhooks).toBe(7);
    expect(result.usage.brandKits).toBe(4);
  });
});

describe('DashboardService.buildPlanUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assembles plan usage snapshot from domain services', async () => {
    const { service } = buildService();
    const result = await service.buildPlanUsage(
      org,
      {
        subscriptionTier: 'PRO',
        createdAt: new Date('2024-01-01'),
        totalChannels: 10,
        extraChannels: 0,
      },
      // getPackageOptions shape: the -10 sentinel when subscribed.
      { ...pricing.PRO, channel: -10 },
    );

    expect(result.postsThisCycle).toBe(12);
    expect(result.postsLimit).toBe(pricing.PRO.posts_per_month);
    expect(result.channels).toBe(2);
    // The real cap comes from the effective merge, not the -10 sentinel.
    expect(result.channelsLimit).toBe(10);
    expect(result.teamMembers).toBe(3);
    expect(result.teamLimit).toBe(pricing.PRO.team_members);
  });

  it('channelsLimit includes channel add-ons and honors limitOverrides', async () => {
    const { service } = buildService();
    const subscription = {
      subscriptionTier: 'PRO',
      createdAt: new Date('2024-01-01'),
      totalChannels: 10,
      extraChannels: 5,
      limitOverrides: null,
    };

    const withAddons = await service.buildPlanUsage(
      org,
      subscription,
      { ...pricing.PRO, channel: -10 },
    );
    expect(withAddons.channelsLimit).toBe(15);

    const withOverride = await service.buildPlanUsage(
      org,
      { ...subscription, limitOverrides: { channel: 42 } },
      { ...pricing.PRO, channel: -10 },
    );
    expect(withOverride.channelsLimit).toBe(42);
  });
});

describe('DashboardService _aiBudgetAlert via getAttention', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('omits the budget item when spend is below the configured threshold', async () => {
    const { service, aiSettingsManager, aiSettingsService } = buildService();
    aiSettingsManager.getSettings = vi.fn().mockResolvedValue({
      budgetSettings: JSON.stringify({ monthlyCap: 100, alertThresholdPct: 0.8 }),
    });
    aiSettingsService.getSpendSummary = vi.fn().mockResolvedValue([
      { _sum: { costUsd: 50 } },
    ]);

    const result = await service.getAttention('org-1', 'user-1', ['budget']);

    expect(result.items).toHaveLength(0);
  });

  it('returns a warning budget item when spend crosses the threshold', async () => {
    const { service, aiSettingsManager, aiSettingsService } = buildService();
    aiSettingsManager.getSettings = vi.fn().mockResolvedValue({
      budgetSettings: JSON.stringify({ monthlyCap: 100, alertThresholdPct: 0.8 }),
    });
    aiSettingsService.getSpendSummary = vi.fn().mockResolvedValue([
      { _sum: { costUsd: 85 } },
    ]);

    const result = await service.getAttention('org-1', 'user-1', ['budget']);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('budget');
    expect(result.items[0].severity).toBe('warning');
    expect(result.items[0].title).toBe('85% of AI budget used');
  });

  it('returns a critical budget item when spend meets or exceeds the cap', async () => {
    const { service, aiSettingsManager, aiSettingsService } = buildService();
    aiSettingsManager.getSettings = vi.fn().mockResolvedValue({
      budgetSettings: JSON.stringify({ monthlyCap: 100 }),
    });
    aiSettingsService.getSpendSummary = vi.fn().mockResolvedValue([
      { _sum: { costUsd: 120 } },
    ]);

    const result = await service.getAttention('org-1', 'user-1', ['budget']);

    expect(result.items[0].severity).toBe('critical');
    expect(result.items[0].title).toBe('120% of AI budget used');
  });

  it('omits the budget item when no monthly cap is configured', async () => {
    const { service, aiSettingsManager } = buildService();
    aiSettingsManager.getSettings = vi.fn().mockResolvedValue({
      budgetSettings: JSON.stringify({}),
    });

    const result = await service.getAttention('org-1', 'user-1', ['budget']);

    expect(result.items).toHaveLength(0);
  });
});

describe('DashboardService.getMediaJobs', () => {
  const jobRow = (over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    provider: 'heygen',
    operation: 'video',
    status: 'completed',
    artifactUrl: '/uploads/a.mp4',
    error: null,
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    ...over,
  });
  const counts = { pending: 0, processing: 0, failed7d: 0 };

  it('resolves the File id for completed artifacts in one query', async () => {
    const { service, aiSettingsService, fileRepository } = buildService();
    aiSettingsService.getMediaJobsWithCounts = vi.fn().mockResolvedValue({
      jobs: [jobRow(), jobRow({ id: 'job-2', artifactUrl: '/uploads/b.mp4' })],
      counts,
    });
    fileRepository.getFilesByPaths = vi
      .fn()
      .mockResolvedValue([{ path: '/uploads/a.mp4', id: 'file-a' }]);

    const result = await service.getMediaJobs('org-1', {});

    expect(fileRepository.getFilesByPaths).toHaveBeenCalledTimes(1);
    expect(fileRepository.getFilesByPaths).toHaveBeenCalledWith('org-1', [
      '/uploads/a.mp4',
      '/uploads/b.mp4',
    ]);
    expect(result.jobs[0].fileId).toBe('file-a');
    // No File row yet (still being written) — null, not a crash.
    expect(result.jobs[1].fileId).toBeNull();
  });

  it("presents the synchronous writer's 'done' as 'completed'", async () => {
    const { service, aiSettingsService, fileRepository } = buildService();
    // AiMediaService._persistJob writes 'done'; the async lifecycle writes
    // 'completed'. Both land in the same table and mean the same thing.
    aiSettingsService.getMediaJobsWithCounts = vi
      .fn()
      .mockResolvedValue({ jobs: [jobRow({ status: 'done' })], counts });
    fileRepository.getFilesByPaths = vi
      .fn()
      .mockResolvedValue([{ path: '/uploads/a.mp4', id: 'file-a' }]);

    const result = await service.getMediaJobs('org-1', {});

    expect(result.jobs[0].status).toBe('completed');
    expect(result.jobs[0].artifactUrl).toBe('/uploads/a.mp4');
    // And it still resolves a File id, so "Post to Composer" works on it.
    expect(result.jobs[0].fileId).toBe('file-a');
  });

  it('never leaks a pending:// artifact ref for an unfinished job', async () => {
    const { service, aiSettingsService, fileRepository } = buildService();
    aiSettingsService.getMediaJobsWithCounts = vi.fn().mockResolvedValue({
      jobs: [jobRow({ status: 'processing', artifactUrl: 'pending://abc123' })],
      counts,
    });

    const result = await service.getMediaJobs('org-1', {});

    expect(result.jobs[0].artifactUrl).toBeNull();
    expect(result.jobs[0].fileId).toBeNull();
    // Nothing completed, so there is nothing to look up.
    expect(fileRepository.getFilesByPaths).not.toHaveBeenCalled();
  });

  it('clamps the page size and passes the filters through', async () => {
    const { service, aiSettingsService } = buildService();
    aiSettingsService.getMediaJobsWithCounts = vi
      .fn()
      .mockResolvedValue({ jobs: [], counts });

    await service.getMediaJobs('org-1', {
      limit: 5000,
      status: 'failed',
      provider: 'runway',
      cursor: 'job-9',
    });

    expect(aiSettingsService.getMediaJobsWithCounts).toHaveBeenCalledWith('org-1', 100, {
      status: 'failed',
      provider: 'runway',
      cursor: 'job-9',
    });
  });

  it('only offers a cursor when the page came back full', async () => {
    const { service, aiSettingsService } = buildService();
    aiSettingsService.getMediaJobsWithCounts = vi
      .fn()
      .mockResolvedValue({ jobs: [jobRow({ artifactUrl: null, status: 'failed' })], counts });

    const partial = await service.getMediaJobs('org-1', { limit: 2 });
    expect(partial.nextCursor).toBeNull();

    aiSettingsService.getMediaJobsWithCounts = vi.fn().mockResolvedValue({
      jobs: [
        jobRow({ id: 'a', artifactUrl: null, status: 'failed' }),
        jobRow({ id: 'b', artifactUrl: null, status: 'failed' }),
      ],
      counts,
    });
    const full = await service.getMediaJobs('org-1', { limit: 2 });
    expect(full.nextCursor).toBe('b');
  });
});
