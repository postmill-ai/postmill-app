import { Injectable, Logger } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { SocialCommentsService } from '@gitroom/nestjs-libraries/database/prisma/social-comments/social.comments.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { OrgAiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-ai-settings.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { FileRepository } from '@gitroom/nestjs-libraries/database/prisma/file/file.repository';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { AiSettingsService } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/ai-settings.service';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import { singleFlight } from '@gitroom/nestjs-libraries/utils/concurrency';

dayjs.extend(utc);
dayjs.extend(timezone);

const SUMMARY_TTL_SECONDS = 60;
const ATTENTION_TTL_SECONDS = 60;

export interface DashboardSummaryResponse {
  totalPosts: number;
  scheduledPosts: number;
  publishedNext7: number;
  channelsConnected: number;
  drafts: number;
  upcomingPosts: Array<{
    id: string;
    content: string | null;
    publishDate: Date;
    channelName: string | null;
    providerIdentifier: string | null;
  }>;
  commentUnreadCount: number;
  aiProviderActive: boolean;
  mediaProviderActive: boolean;
  storageProviderActive: boolean;
  teamMembers: number;
}

export interface DashboardScheduleResponse {
  days: Array<{ date: string; count: number }>;
  gaps: string[];
}

export interface DashboardCampaignSummaryResponse {
  id: string;
  name: string;
  endDate: Date | null;
  postCounts: {
    queue: number;
    published: number;
    draft: number;
    error: number;
  };
  goals: Array<{
    metric: string;
    target: number;
    current: number;
    pct: number;
  }>;
}

export interface DashboardMediaJobsResponse {
  jobs: Array<{
    id: string;
    provider: string;
    operation: string;
    status: string;
    artifactUrl: string | null;
    error: string | null;
    createdAt: Date;
  }>;
  counts: {
    pending: number;
    processing: number;
    failed7d: number;
  };
}

export type AttentionKind =
  | 'failed-posts'
  | 'channel-health'
  | 'pending-approvals'
  | 'unread-comments'
  | 'schedule-gaps'
  | 'budget'
  | 'failed-media-jobs'
  | 'anomalies';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description?: string;
  count?: number;
  link: string;
  action?: {
    label: string;
    type: 'retry-post' | 'dismiss-anomaly' | 'navigate';
    payload?: Record<string, any>;
  };
}

export interface DashboardAttentionResponse {
  items: AttentionItem[];
}

export interface PlanUsageSnapshot {
  postsThisCycle: number;
  postsLimit: number | boolean;
  channels: number;
  channelsLimit: number | boolean;
  teamMembers: number;
  teamLimit: number | boolean;
}

@Injectable()
export class DashboardService {
  private readonly _logger = new Logger(DashboardService.name);

  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _socialCommentsService: SocialCommentsService,
    private _organizationService: OrganizationService,
    private _orgAiSettingsService: OrgAiSettingsService,
    private _aiMediaService: AiMediaService,
    private _storageService: StorageService,
    private _aiSettingsService: AiSettingsService,
    private _campaignsService: CampaignsService,
    private _analyticsService: AnalyticsService,
    private _aiSettingsManager: AiSettingsManager,
    private _redisService: RedisService,
    private _subscriptionService: SubscriptionService,
    private _fileRepository: FileRepository,
  ) {}

  private _summaryCacheKey(orgId: string, userId: string) {
    return `dashboard:summary:${orgId}:${userId}`;
  }

  private _attentionCacheKey(orgId: string, userId: string) {
    return `dashboard:attention:${orgId}:${userId}`;
  }

  async getSummary(
    org: Organization,
    user: User
  ): Promise<DashboardSummaryResponse> {
    const orgId = org.id;
    const userId = user?.id ?? '';
    const cacheKey = this._summaryCacheKey(orgId, userId);

    try {
      const cached = await this._redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DashboardSummaryResponse;
      }
    } catch {
      // cache miss — continue
    }

    return singleFlight(cacheKey, async () => {
      try {
        const cached = await this._redisService.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as DashboardSummaryResponse;
        }
      } catch {
        // continue
      }

      const result = await this._computeSummary(org, user);
      this._redisService
        .set(cacheKey, JSON.stringify(result), SUMMARY_TTL_SECONDS)
        .catch(() => {});
      return result;
    });
  }

  private async _computeSummary(
    org: Organization,
    user: User
  ): Promise<DashboardSummaryResponse> {
    const orgId = org.id;
    const sevenDaysAgo = dayjs.utc().subtract(7, 'days').toDate();

    const [
      integrations,
      team,
      aiConfig,
      storageConfigs,
      totalPosts,
      scheduledPosts,
      publishedNext7,
      drafts,
      upcomingPosts,
      commentUnread,
      mediaSummary,
    ] = await Promise.all([
      this._integrationService.getIntegrationsList(orgId),
      this._organizationService.getTeam(orgId),
      this._orgAiSettingsService.getActiveProvider(orgId),
      this._storageService.getProviderConfigs(orgId),
      this._postsService.getTotalCount(orgId),
      this._postsService.getScheduledCount(orgId),
      this._postsService.getPublishedCountSince(orgId, sevenDaysAgo),
      this._postsService.getDraftCount(orgId),
      this._postsService.getUpcomingPosts(orgId, 5),
      this._socialCommentsService.getInboxUnreadCount(orgId, user?.id),
      this._aiMediaService.getMediaProviderSummary(orgId),
    ]);

    const storageProviderActive = (storageConfigs || []).some(
      (c: { type?: string }) => c.type && c.type !== 'LOCAL'
    );
    const mediaProviderActive = mediaSummary.some((e) => e.available);

    return {
      totalPosts,
      scheduledPosts,
      publishedNext7,
      channelsConnected: integrations.length,
      drafts,
      upcomingPosts: upcomingPosts.map((p) => ({
        id: p.id,
        content: p.content?.substring(0, 100) ?? null,
        publishDate: p.publishDate,
        channelName: p.integration?.name ?? null,
        providerIdentifier: p.integration?.providerIdentifier ?? null,
      })),
      commentUnreadCount: commentUnread?.unreadCount ?? 0,
      aiProviderActive: !!aiConfig,
      mediaProviderActive,
      storageProviderActive,
      teamMembers: team?.users?.length ?? 0,
    };
  }

  async getSchedule(
    orgId: string,
    days: number,
    timezone: string
  ): Promise<DashboardScheduleResponse> {
    return this._postsService.getSchedule(orgId, days, timezone);
  }

  async getCampaignSummaries(
    orgId: string,
    limit = 6
  ): Promise<DashboardCampaignSummaryResponse[]> {
    return this._campaignsService.getSummaries(orgId, limit);
  }

  async getMediaJobs(
    orgId: string
  ): Promise<DashboardMediaJobsResponse> {
    const { jobs, counts } = await this._aiSettingsService.getMediaJobsWithCounts(
      orgId,
      20
    );
    return {
      jobs: jobs.map((j: any) => ({
        id: j.id,
        provider: j.provider,
        operation: j.operation,
        status: j.status,
        artifactUrl: j.artifactUrl ?? null,
        error: j.error ?? null,
        createdAt: j.createdAt,
      })),
      counts,
    };
  }

  // ── Usage aggregation (A-04) ──

  async buildUsage(
    org: Organization,
    subscription: { subscriptionTier?: string; createdAt?: Date; extraVideoExports?: number; totalChannels?: number } | null | undefined,
    options: {
      posts_per_month: number | boolean;
      channel: number | boolean;
      team_members: number | boolean;
      storage_gb: number;
      video_exports: number;
    },
    byoStorageActive: boolean
  ) {
    const createdAt = subscription?.createdAt || org.createdAt;
    const totalMonthPast = Math.abs(dayjs(createdAt).diff(dayjs(), 'month'));
    const checkFrom = dayjs(createdAt).add(totalMonthPast, 'month');

    const [postsThisCycle, integrations, team, storageBytes, videoExportsUsed] =
      await Promise.all([
        this._postsService.countPostsFromDay(org.id, checkFrom.toDate()),
        this._integrationService.getIntegrationsList(org.id),
        this._organizationService.getTeam(org.id),
        this._fileRepository.getStorageBytes(org.id),
        this._subscriptionService.getCreditsFrom(
          org.id,
          checkFrom,
          'video_export'
        ),
      ]);

    return {
      billingEnabled: true,
      tier: subscription?.subscriptionTier || 'STARTER',
      byoStorageActive,
      limits: {
        postsPerMonth: options.posts_per_month,
        // A subscribed org's real channel cap is subscription.totalChannels;
        // options.channel is the -10 "effectively unlimited when paid" sentinel.
        channels: subscription ? subscription.totalChannels : options.channel,
        teamMembers: options.team_members,
        storageGb: options.storage_gb,
        videoExports: options.video_exports,
      },
      usage: {
        postsThisCycle,
        channels: integrations.filter((i) => !i.refreshNeeded).length,
        teamMembers: team?.users?.filter((u) => !u.disabled).length ?? 0,
        storageBytes,
        videoExports: videoExportsUsed,
      },
    };
  }

  async buildPlanUsage(
    org: Organization,
    subscription:
      | { subscriptionTier?: string; createdAt?: Date; totalChannels?: number }
      | null
      | undefined,
    options: {
      posts_per_month: number | boolean;
      channel: number | boolean;
      team_members: number | boolean;
    }
  ): Promise<PlanUsageSnapshot> {
    const createdAt = subscription?.createdAt || org.createdAt;
    const totalMonthPast = Math.abs(dayjs(createdAt).diff(dayjs(), 'month'));
    const checkFrom = dayjs(createdAt).add(totalMonthPast, 'month');

    const [postsThisCycle, integrations, team] = await Promise.all([
      this._postsService.countPostsFromDay(org.id, checkFrom.toDate()),
      this._integrationService.getIntegrationsList(org.id),
      this._organizationService.getTeam(org.id),
    ]);

    return {
      postsThisCycle,
      postsLimit: options.posts_per_month,
      channels: integrations.filter((i) => !i.refreshNeeded).length,
      channelsLimit: subscription?.totalChannels ?? options.channel,
      teamMembers: team?.users?.filter((u) => !u.disabled).length ?? 0,
      teamLimit: options.team_members,
    };
  }

  async getAttention(
    orgId: string,
    userId: string,
    permittedKinds: AttentionKind[],
    planUsage?: PlanUsageSnapshot,
    timezone?: string,
  ): Promise<DashboardAttentionResponse> {
    const cacheKey = this._attentionCacheKey(orgId, userId);

    try {
      const cached = await this._redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DashboardAttentionResponse;
      }
    } catch {
      // cache miss — continue
    }

    return singleFlight(cacheKey, async () => {
      try {
        const cached = await this._redisService.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as DashboardAttentionResponse;
        }
      } catch {
        // continue
      }

      const result = await this._computeAttention(orgId, userId, permittedKinds, planUsage, timezone);
      this._redisService
        .set(cacheKey, JSON.stringify(result), ATTENTION_TTL_SECONDS)
        .catch(() => {});
      return result;
    });
  }

  private async _computeAttention(
    orgId: string,
    userId: string,
    permittedKinds: AttentionKind[],
    planUsage?: PlanUsageSnapshot,
    timezone?: string,
  ): Promise<DashboardAttentionResponse> {
    const tz = timezone || 'UTC';
    const items: AttentionItem[] = [];
    const since7d = dayjs.utc().subtract(7, 'days').toDate();

    const allowed = (kind: AttentionKind) => permittedKinds.includes(kind);

    if (allowed('failed-posts')) {
      try {
        const [failed, count] = await Promise.all([
          this._postsService.getFailedPosts(orgId, since7d, 5),
          this._postsService.getFailedPostCount(orgId, since7d),
        ]);
        if (count > 0) {
          items.push({
            id: 'failed-posts',
            kind: 'failed-posts',
            severity: 'critical',
            title: count === 1 ? '1 post failed' : `${count} posts failed`,
            description: 'Recent publish failures need action.',
            count,
            link: '/posts',
            action: {
              label: 'Retry',
              type: 'retry-post',
              payload: {
                posts: failed.map((p: any) => ({
                  id: p.id,
                  content: p.content,
                  error: p.error,
                  channelName: p.integration?.name,
                  providerIdentifier: p.integration?.providerIdentifier,
                })),
              },
            },
          });
        }
      } catch (err) {
        this._logger.warn(`failed-posts probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('channel-health')) {
      try {
        const unhealthy = await this._integrationService.getHealthSummary(orgId);
        if (unhealthy.length > 0) {
          items.push({
            id: 'channel-health',
            kind: 'channel-health',
            severity: 'critical',
            title: `${unhealthy.length} channel${unhealthy.length === 1 ? '' : 's'} need attention`,
            description: 'Reconnect or re-enable channels to keep publishing.',
            count: unhealthy.length,
            link: '/settings?tab=channels',
          });
        }
      } catch (err) {
        this._logger.warn(`channel-health probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('pending-approvals')) {
      try {
        const count = await this._postsService.getPendingApprovalPostCount(orgId);
        if (count > 0) {
          items.push({
            id: 'pending-approvals',
            kind: 'pending-approvals',
            severity: 'warning',
            title: count === 1 ? '1 draft pending approval' : `${count} drafts pending approval`,
            link: '/campaigns',
          });
        }
      } catch (err) {
        this._logger.warn(`pending-approvals probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('unread-comments')) {
      try {
        const { unreadCount = 0 } =
          (await this._socialCommentsService.getInboxUnreadCount(orgId, userId)) || {};
        if (unreadCount > 0) {
          items.push({
            id: 'unread-comments',
            kind: 'unread-comments',
            severity: 'warning',
            title: `${unreadCount} unread comment${unreadCount === 1 ? '' : 's'}`,
            link: '/replies',
          });
        }
      } catch (err) {
        this._logger.warn(`unread-comments probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('schedule-gaps')) {
      try {
        const { days, gaps } = await this._postsService.getSchedule(orgId, 7, tz);
        if (gaps.length > 0) {
          items.push({
            id: 'schedule-gaps',
            kind: 'schedule-gaps',
            severity: 'info',
            title: `${gaps.length} gap${gaps.length === 1 ? '' : 's'} in your schedule`,
            description: 'No posts scheduled on these days.',
            link: '/posts/post',
          });
        }
      } catch (err) {
        this._logger.warn(`schedule-gaps probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('budget')) {
      try {
        const aiAlert = await this._aiBudgetAlert(orgId, planUsage);
        if (aiAlert) {
          items.push(aiAlert);
        }
        if (planUsage) {
          const planPct =
            typeof planUsage.postsLimit === 'number'
              ? planUsage.postsThisCycle / planUsage.postsLimit
              : 0;
          if (planPct >= 0.8) {
            items.push({
              id: 'plan-usage',
              kind: 'budget',
              severity: planPct >= 1 ? 'critical' : 'warning',
              title: `${Math.round(planPct * 100)}% of monthly posts used`,
              link: '/billing',
            });
          }
        }
      } catch (err) {
        this._logger.warn(`budget probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('failed-media-jobs')) {
      try {
        const { counts } = await this._aiSettingsService.getMediaJobsWithCounts(orgId, 1);
        if (counts.failed7d > 0) {
          items.push({
            id: 'failed-media-jobs',
            kind: 'failed-media-jobs',
            severity: 'warning',
            title: `${counts.failed7d} media job${counts.failed7d === 1 ? '' : 's'} failed`,
            link: '/media',
          });
        }
      } catch (err) {
        this._logger.warn(`failed-media-jobs probe error: ${(err as Error).message}`);
      }
    }

    if (allowed('anomalies')) {
      try {
        const anomalies = await this._analyticsService.listAnomalies(orgId, {
          includeDismissed: false,
          limit: 3,
        });
        for (const a of anomalies as any[]) {
          items.push({
            id: `anomaly-${a.id}`,
            kind: 'anomalies',
            severity: 'info',
            title: a.title || 'Analytics anomaly',
            description: a.description,
            link: '/analytics?tab=insights',
            action: {
              label: 'Dismiss',
              type: 'dismiss-anomaly',
              payload: { id: a.id },
            },
          });
        }
      } catch (err) {
        this._logger.warn(`anomalies probe error: ${(err as Error).message}`);
      }
    }

    const severityRank = { critical: 0, warning: 1, info: 2 };
    items.sort((a, b) => {
      const sevDiff = severityRank[a.severity] - severityRank[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return (b.count ?? 0) - (a.count ?? 0);
    });

    return { items };
  }

  private async _aiBudgetAlert(
    orgId: string,
    _planUsage?: PlanUsageSnapshot
  ): Promise<AttentionItem | null> {
    const settings = await this._aiSettingsManager.getSettings();
    let budgetSettings: { monthlyCap?: number; alertThresholdPct?: number } | undefined;
    if (settings?.budgetSettings) {
      try {
        budgetSettings = JSON.parse(settings.budgetSettings);
      } catch (err) {
        this._logger.warn(
          `Invalid budgetSettings JSON for org ${orgId}: ${(err as Error).message}`
        );
        budgetSettings = undefined;
      }
    }

    if (!budgetSettings?.monthlyCap) {
      return null;
    }

    const threshold = budgetSettings.alertThresholdPct ?? 0.8;
    const startOfMonth = dayjs.utc().startOf('month').toDate();
    const spend = await this._aiSettingsService.getSpendSummary(orgId, startOfMonth);
    const total = spend.reduce((sum, row: any) => sum + (row._sum?.costUsd ?? 0), 0);
    const pct = total / budgetSettings.monthlyCap;

    if (pct < threshold) {
      return null;
    }

    return {
      id: 'ai-budget',
      kind: 'budget',
      severity: pct >= 1 ? 'critical' : 'warning',
      title: `${Math.round(pct * 100)}% of AI budget used`,
      link: '/settings?tab=ai',
    };
  }
}
