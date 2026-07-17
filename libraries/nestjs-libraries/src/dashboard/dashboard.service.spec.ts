import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService, DashboardSummaryResponse } from './dashboard.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';

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

    expect(aiSettingsService.getMediaJobsWithCounts).toHaveBeenCalledWith(
      'org-1',
      20,
    );
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
      { posts_per_month: 1000, channel: -10, team_members: 5 },
    );

    expect(result.billingEnabled).toBe(true);
    expect(result.tier).toBe('PRO');
    expect(result.usage.postsThisCycle).toBe(12);
    expect(result.usage.channels).toBe(2);
    expect(result.usage.teamMembers).toBe(3);
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
      { subscriptionTier: 'PRO', createdAt: new Date('2024-01-01') },
      { posts_per_month: 1000, channel: -10, team_members: 5 },
    );

    expect(result.postsThisCycle).toBe(12);
    expect(result.postsLimit).toBe(1000);
    expect(result.channels).toBe(2);
    expect(result.channelsLimit).toBe(-10);
    expect(result.teamMembers).toBe(3);
    expect(result.teamLimit).toBe(5);
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
