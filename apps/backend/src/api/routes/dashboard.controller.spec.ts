import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

vi.mock('@gitroom/nestjs-libraries/dashboard/dashboard.service', () => ({
  DashboardService: class {},
}));
vi.mock('@gitroom/nestjs-libraries/dashboard/dashboard-brief.service', () => ({
  DashboardBriefService: class {},
}));
vi.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class {},
}));

import { DashboardController } from './dashboard.controller';
import type { DashboardService } from '@gitroom/nestjs-libraries/dashboard/dashboard.service';
import type { DashboardBriefService } from '@gitroom/nestjs-libraries/dashboard/dashboard-brief.service';

const org = { id: 'org-1', timezone: 'UTC', createdAt: new Date('2024-01-01') } as any;
const user = { id: 'user-1' } as any;

const summaryFixture = {
  totalPosts: 12,
  scheduledPosts: 3,
  publishedNext7: 5,
  channelsConnected: 2,
  drafts: 2,
  upcomingPosts: [
    {
      id: 'post-1',
      content: 'Hello world',
      publishDate: new Date('2026-06-11T10:00:00.000Z'),
      channelName: 'My X',
      providerIdentifier: 'x',
    },
  ],
  commentUnreadCount: 4,
  aiProviderActive: true,
  mediaProviderActive: true,
  storageProviderActive: false,
  teamMembers: 3,
};

describe('DashboardController', () => {
  let dashboardService: {
    getSummary: ReturnType<typeof vi.fn>;
    getSchedule: ReturnType<typeof vi.fn>;
    getCampaignSummaries: ReturnType<typeof vi.fn>;
    getMediaJobs: ReturnType<typeof vi.fn>;
    getAttention: ReturnType<typeof vi.fn>;
    buildUsage: ReturnType<typeof vi.fn>;
    buildPlanUsage: ReturnType<typeof vi.fn>;
  };
  let briefService: {
    getCachedBrief: ReturnType<typeof vi.fn>;
    generateBrief: ReturnType<typeof vi.fn>;
  };
  let permissionsService: {
    getPackageOptions: ReturnType<typeof vi.fn>;
    getEffectiveLimits: ReturnType<typeof vi.fn>;
  };
  let rolesService: {
    getEffectivePermissions: ReturnType<typeof vi.fn>;
  };
  let controller: DashboardController;

  beforeEach(() => {
    dashboardService = {
      getSummary: vi.fn().mockResolvedValue(summaryFixture),
      getSchedule: vi.fn().mockResolvedValue({ days: [], gaps: [] }),
      getCampaignSummaries: vi.fn().mockResolvedValue([]),
      getMediaJobs: vi.fn().mockResolvedValue({ jobs: [], counts: {} }),
      getAttention: vi.fn().mockResolvedValue({ items: [] }),
      buildUsage: vi.fn().mockResolvedValue({
        billingEnabled: true,
        tier: 'PRO',
        limits: {
          postsPerMonth: 1000,
          channels: -10,
          teamMembers: 5,
        },
        usage: {
          postsThisCycle: 12,
          channels: 1,
          teamMembers: 2,
        },
      }),
      buildPlanUsage: vi.fn().mockResolvedValue({
        postsThisCycle: 12,
        postsLimit: 1000,
        channels: 1,
        channelsLimit: -10,
        teamMembers: 2,
        teamLimit: 5,
      }),
    };
    briefService = {
      getCachedBrief: vi.fn().mockResolvedValue({ cached: false }),
      generateBrief: vi.fn().mockResolvedValue({ brief: 'Brief text', generatedAt: '2026-01-01T00:00:00Z' }),
    };
    permissionsService = {
      getPackageOptions: vi.fn().mockResolvedValue({
        subscription: { subscriptionTier: 'PRO', createdAt: new Date('2024-01-01') },
        options: { posts_per_month: 1000, channel: -10, team_members: 5 },
      }),
      getEffectiveLimits: vi.fn().mockResolvedValue({
        subscription: { subscriptionTier: 'PRO', createdAt: new Date('2024-01-01') },
        options: { posts_per_month: 1000, channel: -10, team_members: 5, storage_gb: 5, video_exports: 60 },
        byoStorageActive: false,
      }),
    };
    rolesService = {
      getEffectivePermissions: vi.fn().mockResolvedValue({
        role: 'owner',
        permissions: ['posts:read', 'billing:read', 'comments:read', 'media:read', 'analytics:read', 'posts:update'],
      }),
    };

    controller = new DashboardController(
      dashboardService as unknown as DashboardService,
      permissionsService as any,
      rolesService as any,
      briefService as unknown as DashboardBriefService,
    );
  });

  it('throws UnauthorizedException when there is no org', async () => {
    await expect(controller.getSummary(undefined as any, user)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(controller.getSummary({} as any, user)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(dashboardService.getSummary).not.toHaveBeenCalled();
  });

  it('returns the summary shape the dashboard frontend relies on', async () => {
    const result = await controller.getSummary(org, user);
    expect(result).toEqual(summaryFixture);
  });

  it('scopes the summary lookup to the requesting org and user', async () => {
    await controller.getSummary(org, user);
    expect(dashboardService.getSummary).toHaveBeenCalledWith(org, user);
  });

  it('returns usage numbers when billing is enabled', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const result = await controller.getUsage(org);

    expect(result.billingEnabled).toBe(true);
    if (!('usage' in result)) {
      throw new Error('expected usage to be present');
    }
    expect(result.usage.postsThisCycle).toBe(12);
    expect(result.usage.channels).toBe(1);
    expect(result.usage.teamMembers).toBe(2);
    expect(dashboardService.buildUsage).toHaveBeenCalledWith(
      org,
      expect.objectContaining({ subscriptionTier: 'PRO' }),
      expect.objectContaining({ posts_per_month: 1000 }),
      false,
    );
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  it('returns minimal usage payload when billing is disabled', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const result = await controller.getUsage(org);
    expect(result).toEqual({ billingEnabled: false });
    expect(dashboardService.buildUsage).not.toHaveBeenCalled();
  });

  it('filters attention kinds by effective permissions', async () => {
    await controller.getAttention(org, user);
    expect(dashboardService.getAttention).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.arrayContaining(['failed-posts', 'channel-health', 'pending-approvals', 'unread-comments', 'schedule-gaps', 'budget', 'failed-media-jobs', 'anomalies']),
      expect.any(Object),
      undefined,
    );
  });

  it('GET /brief returns the cached brief response', async () => {
    briefService.getCachedBrief.mockResolvedValue({
      brief: 'Already cached',
      generatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await controller.getBrief(org, user);

    expect(briefService.getCachedBrief).toHaveBeenCalledWith(org, user);
    expect(result).toEqual({ brief: 'Already cached', generatedAt: '2026-01-01T00:00:00Z' });
  });

  it('POST /brief delegates to brief service with permitted kinds and plan usage', async () => {
    const result = await controller.generateBrief(org, user);

    expect(briefService.generateBrief).toHaveBeenCalledWith(
      org,
      user,
      expect.arrayContaining(['failed-posts', 'channel-health', 'pending-approvals', 'unread-comments', 'schedule-gaps', 'budget', 'failed-media-jobs', 'anomalies']),
      expect.any(Object),
    );
    expect(result).toEqual({ brief: 'Brief text', generatedAt: '2026-01-01T00:00:00Z' });
  });

  describe('GET /schedule', () => {
    it('returns the schedule from the dashboard service', async () => {
      const schedule = { days: [{ date: '2026-06-11' }], gaps: [] as any[] };
      dashboardService.getSchedule.mockResolvedValue(schedule);

      const result = await controller.getSchedule(org, 14, 'America/New_York');

      expect(dashboardService.getSchedule).toHaveBeenCalledWith(
        'org-1',
        14,
        'America/New_York',
      );
      expect(result).toEqual(schedule);
    });

    it('clamps days to [1, 30] and falls back to UTC when timezone is omitted', async () => {
      await controller.getSchedule(org, 0);
      expect(dashboardService.getSchedule).toHaveBeenCalledWith('org-1', 1, 'UTC');

      await controller.getSchedule(org, 365);
      expect(dashboardService.getSchedule).toHaveBeenCalledWith('org-1', 30, 'UTC');
    });

    it('throws UnauthorizedException when org is missing', async () => {
      await expect(controller.getSchedule(undefined as any, 7)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dashboardService.getSchedule).not.toHaveBeenCalled();
    });
  });

  describe('GET /campaigns', () => {
    it('returns campaign summaries from the dashboard service', async () => {
      const campaigns = [{ id: 'c1', name: 'Launch' }];
      dashboardService.getCampaignSummaries.mockResolvedValue(campaigns);

      const result = await controller.getCampaigns(org, 10);

      expect(dashboardService.getCampaignSummaries).toHaveBeenCalledWith(
        'org-1',
        10,
      );
      expect(result).toEqual(campaigns);
    });

    it('clamps limit to [1, 50]', async () => {
      await controller.getCampaigns(org, 0);
      expect(dashboardService.getCampaignSummaries).toHaveBeenCalledWith(
        'org-1',
        1,
      );

      await controller.getCampaigns(org, 100);
      expect(dashboardService.getCampaignSummaries).toHaveBeenCalledWith(
        'org-1',
        50,
      );
    });

    it('throws UnauthorizedException when org is missing', async () => {
      await expect(controller.getCampaigns(undefined as any, 6)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dashboardService.getCampaignSummaries).not.toHaveBeenCalled();
    });
  });

  describe('GET /media-jobs', () => {
    it('returns media jobs from the dashboard service', async () => {
      const jobs = { jobs: [{ id: 'j1' }], counts: {} };
      dashboardService.getMediaJobs.mockResolvedValue(jobs);

      const result = await controller.getMediaJobs(org);

      expect(dashboardService.getMediaJobs).toHaveBeenCalledWith('org-1');
      expect(result).toEqual(jobs);
    });

    it('throws UnauthorizedException when org is missing', async () => {
      await expect(controller.getMediaJobs(undefined as any)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dashboardService.getMediaJobs).not.toHaveBeenCalled();
    });
  });
});
