import { Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OrgProviderConfigManager } from '@gitroom/nestjs-libraries/integrations/org-provider-config.manager';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { WatchlistService } from '@gitroom/nestjs-libraries/database/prisma/watchlist/watchlist.service';
import { PROVIDER_CAPABILITIES } from '@gitroom/nestjs-libraries/integrations/social/provider-capabilities';
import {
  normalizeMetric,
  METRIC_REGISTRY,
} from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { timer } from '@gitroom/helpers/utils/timer';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { decryptIntegrationTokens, decryptPostIntegrationTokens } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration-token.utils';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { EmailLogService } from '@gitroom/nestjs-libraries/database/prisma/emails/email-log.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import { getRetentionDays } from '@gitroom/nestjs-libraries/analytics/analytics-aggregation';
import { stripHtmlTags } from '@gitroom/helpers/utils/strip.tags';

dayjs.extend(isoWeek);

// I-02: the fields required by the per-integration fan-out event and by
// collectChannelSnapshotForIntegration. Matches the 'analytics/sync-integration'
// Inngest event payload so the handler can pass event.data through directly.
export interface ChannelSnapshotIntegrationRef {
  id: string;
  type: string;
  disabled: boolean;
  deletedAt: Date | null;
  providerIdentifier: string;
  providerVersion?: string | null;
  internalId: string;
  token: string;
  tokenExpiration?: Date | null;
  refreshToken: string;
  name: string;
  picture: string | null;
  rootInternalId: string;
  organizationId: string;
  providerConfigId?: string | null;
}

const CHANNEL_DAYS_BACK = 7;
const POST_SNAPSHOT_BATCH_SIZE = 500;

// 6.9: structured "your week in numbers" summary returned by buildWeeklySummary.
export interface WeeklyAnalyticsSummary {
  orgId: string;
  weekStart: Date;
  weekEnd: Date;
  metrics: {
    metric: string;
    label: string;
    thisWeek: number;
    lastWeek: number;
    changePct: number | null;
  }[];
  topPost: { postId: string; title: string; metric: string; value: number } | null;
  bestChannel: { integrationId: string; name: string; total: number } | null;
  anomalyRecap: string | null;
  hasData: boolean;
}


@Injectable()
export class AnalyticsActivity {
  private readonly logger = new Logger(AnalyticsActivity.name);

  constructor(
    private readonly _analyticsService: AnalyticsService,
    private readonly _integrationManager: IntegrationManager,
    private readonly _orgProviderConfigManager: OrgProviderConfigManager,
    private readonly _organizationService: OrganizationService,
    private readonly _integrationService: IntegrationService,
    private readonly _refreshIntegrationService: RefreshIntegrationService,
    private readonly _webhooksService: WebhooksService,
    private readonly _watchlistService: WatchlistService,
    private readonly _shortLinkSettingsService: OrgShortLinkSettingsService,
    private readonly _resolution: ProviderResolutionService,
    private readonly _emailLogService: EmailLogService,
    private readonly _notificationService: NotificationService,
  ) {}

  async getAllOrganizationIds(): Promise<string[]> {
    const orgs = await this._organizationService.getAllIds();
    return orgs.map((o) => o.id);
  }

  async getChannelSnapshotIntegrationIds(
    orgId: string
  ): Promise<ChannelSnapshotIntegrationRef[]> {
    await this._orgProviderConfigManager.ensureFresh(orgId);

    const integrations = await this._integrationService.getIntegrationsList(
      orgId
    );
    return integrations.filter(
      (i) => i.type === 'social' && !i.disabled && !i.deletedAt
    ) as ChannelSnapshotIntegrationRef[];
  }

  async collectChannelSnapshots(
    orgId: string,
    daysBack: number = CHANNEL_DAYS_BACK
  ): Promise<void> {
    await this._orgProviderConfigManager.ensureFresh(orgId);

    const integrations = await this._integrationService.getIntegrationsList(
      orgId
    );
    const socialIntegrations = integrations.filter(
      (i) => i.type === 'social' && !i.disabled && !i.deletedAt
    );

    for (const integration of socialIntegrations) {
      await this.collectChannelSnapshotForIntegration(
        orgId,
        integration,
        daysBack
      );
    }
  }

  async collectChannelSnapshotForIntegration(
    orgId: string,
    integration: ChannelSnapshotIntegrationRef,
    daysBack: number = CHANNEL_DAYS_BACK
  ): Promise<void> {
    await this._orgProviderConfigManager.ensureFresh(orgId);

    if (
      integration.type !== 'social' ||
      integration.disabled ||
      integration.deletedAt
    ) {
      return;
    }

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      integration.providerIdentifier,
      integration.providerVersion ?? undefined
    );
    if (!provider?.analytics) return;

    let token = integration.token;
    if (
      integration.tokenExpiration &&
      dayjs(integration.tokenExpiration).isBefore(dayjs())
    ) {
      const refreshed = await this._refreshIntegrationService.refresh(
        integration as Integration
      );
      if (!refreshed || !refreshed.accessToken) return;
      token = refreshed.accessToken;
      if (provider.refreshWait) {
        await timer(10000);
      }
    }

    const channelRows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[] = [];

    try {
      const clientInformation = await this._integrationManager.requireClientInformation(
        integration.providerIdentifier,
        integration.organizationId,
        integration.providerConfigId
      ).catch(() => undefined);

      const data = await provider.analytics(
        integration.internalId,
        token,
        daysBack,
        clientInformation
      );

      for (const entry of data) {
        const canonical = normalizeMetric(
          integration.providerIdentifier,
          entry.label
        );
        if (!canonical) continue;

        for (const point of entry.data) {
          const val = parseFloat(String(point.total));
          if (isNaN(val)) continue;

          channelRows.push({
            organizationId: orgId,
            integrationId: integration.id,
            metric: canonical,
            value: val,
            date: dayjs(point.date).startOf('day').toDate(),
          });
        }
      }

      if (channelRows.length > 0) {
        await this._analyticsService.upsertChannelSnapshots(channelRows);
      }
    } catch (err: any) {
      if (err instanceof RefreshToken) {
        return;
      }
      this.logger.error(
        `AnalyticsActivity: Error collecting analytics for ${integration.id}:`,
        { integrationId: integration.id, providerId: integration.providerIdentifier, error: err?.message }
      );
    }
  }

  // Process one keyset page of posts for snapshot collection. Durable callers
  // (the Inngest sync-org function) loop over this with a per-page step.run so
  // the cursor is checkpointed across retries; the all-pages wrapper below stays
  // available for callers that don't need durability.
  async collectPostSnapshotsPage(
    orgId: string,
    daysBack: number,
    cursor?: string
  ): Promise<{ nextCursor?: string; processed: number }> {
    await this._orgProviderConfigManager.ensureFresh(orgId);
    const since = dayjs().subtract(daysBack, 'day').startOf('day').toDate();

    const posts = (
      await this._analyticsService.findPostsForSnapshots(
        orgId,
        since,
        POST_SNAPSHOT_BATCH_SIZE,
        cursor
      )
    ).map(decryptPostIntegrationTokens);

    for (const post of posts) {
      if (!post.releaseId || post.releaseId === 'missing') continue;

      const postRows: {
        organizationId: string;
        postId: string;
        integrationId: string;
        metric: string;
        value: number;
        date: Date;
      }[] = [];

      try {
        const provider = this._integrationManager.getSocialIntegrationUnchecked(
          post.integration.providerIdentifier,
          post.integration.providerVersion ?? undefined
        );
        if (!provider?.postAnalytics) continue;

        let token = post.integration.token;
        if (
          post.integration.tokenExpiration &&
          dayjs(post.integration.tokenExpiration).isBefore(dayjs())
        ) {
          const refreshed = await this._refreshIntegrationService.refresh(
            post.integration
          );
          if (!refreshed || !refreshed.accessToken) continue;
          token = refreshed.accessToken;
          if (provider.refreshWait) {
            await timer(10000);
          }
        }

        const clientInformation = await this._integrationManager.requireClientInformation(
          post.integration.providerIdentifier,
          post.integration.organizationId,
          post.integration.providerConfigId
        ).catch(() => undefined);

        const data = await provider.postAnalytics(
          post.integration.internalId,
          token,
          post.releaseId,
          2,
          clientInformation
        );

        for (const entry of data) {
          const canonical = normalizeMetric(
            post.integration.providerIdentifier,
            entry.label
          );
          if (!canonical) continue;

          for (const point of entry.data) {
            const val = parseFloat(String(point.total));
            if (isNaN(val)) continue;

            postRows.push({
              organizationId: orgId,
              postId: post.id,
              integrationId: post.integrationId,
              metric: canonical,
              value: val,
              date: dayjs(point.date).startOf('day').toDate(),
            });
          }
        }

        if (postRows.length > 0) {
          await this._analyticsService.upsertPostSnapshots(postRows);
        }

        // Update denormalized counters on the Post record
        const latestSnapshots =
          await this._analyticsService.getLatestPostSnapshots(orgId, [post.id], [
            'views',
            'likes',
            'comments',
            'impressions',
            'reactions',
            'replies',
          ]);

        const latestByMetric: Record<string, number> = {};
        for (const snap of latestSnapshots) {
          if (!(snap.metric in latestByMetric)) {
            latestByMetric[snap.metric] = snap.value;
          }
        }

        const updateData: Record<string, number> = {};
        const views = latestByMetric['views'] || latestByMetric['impressions'];
        const likes = latestByMetric['likes'] || latestByMetric['reactions'];
        const comments = latestByMetric['comments'] || latestByMetric['replies'];
        if (views !== undefined) updateData.lastViews = views;
        if (likes !== undefined) updateData.lastLikes = likes;
        if (comments !== undefined) updateData.lastComments = comments;

        if (Object.keys(updateData).length > 0) {
          await this._analyticsService.updatePostCounters(
            orgId,
            post.id,
            updateData
          );
        }
      } catch (err: any) {
        if (err instanceof RefreshToken) {
          continue;
        }
        this.logger.error(
          `AnalyticsActivity: Error collecting post analytics for ${post.id}:`,
          { postId: post.id, integrationId: post.integrationId, providerId: post.integration?.providerIdentifier, error: err?.message }
        );
      }
    }

    return {
      nextCursor:
        posts.length === POST_SNAPSHOT_BATCH_SIZE
          ? posts[posts.length - 1].id
          : undefined,
      processed: posts.length,
    };
  }

  // Non-durable all-pages wrapper. Keeps the original contract for callers and
  // tests that don't need per-page checkpointing.
  async collectPostSnapshots(orgId: string, daysBack: number): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.collectPostSnapshotsPage(orgId, daysBack, cursor);
      cursor = result.nextCursor;
    } while (cursor);
  }

  async pruneAndRollupSnapshots(orgId: string): Promise<void> {
    return this._analyticsService.pruneAndRollupSnapshots(orgId);
  }

  async notifySnapshotComplete(orgId: string): Promise<void> {
    try {
      await this._webhooksService.dispatchEvent(orgId, 'analytics.snapshot_complete', {
        orgId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('notifySnapshotComplete error:', { error: (err as Error)?.message });
    }
  }

  // ── Anomaly detection (Phase 4) ──
  // Loads 35d of channel snapshots, runs the pure detector per (integration,
  // metric), persists anomaly rows idempotently, and fires notifications
  // (cooldown-gated, capped 3/org/day). Never throws — a detection failure must
  // not fail the sweep (same posture as notifySnapshotComplete).
  async detectAnomalies(orgId: string): Promise<void> {
    return this._analyticsService.detectAnomalies(orgId);
  }

  // ── Weekly "your week in numbers" summary (6.9) ──
  // Composes this-week-vs-last-week FLOW-metric totals from two non-overlapping
  // 7-day windows of channel snapshots (grouped/summed here — never through
  // AnalyticsService), plus a top post, the best channel, and a one-line anomaly
  // recap, then fires the weekly `analytics`-category digest notification. Only
  // reads existing repo methods. Non-fatal: never throws, so it can ride the
  // daily sweep as a swallowed step.
  async buildWeeklySummary(
    orgId: string
  ): Promise<WeeklyAnalyticsSummary | null> {
    try {
      const integrations =
        await this._analyticsService.getBestTimeIntegrations(orgId);
      if (integrations.length === 0) return null;
      const integrationIds = integrations.map((i) => i.id);
      const nameById = new Map(
        integrations.map((i) => [i.id, i.name || 'a channel'])
      );

      // Two non-overlapping 7-day windows: the trailing week vs the week before.
      const thisFrom = dayjs().subtract(6, 'day').startOf('day').toDate();
      const thisTo = dayjs().endOf('day').toDate();
      const lastFrom = dayjs().subtract(13, 'day').startOf('day').toDate();
      const lastTo = dayjs().subtract(7, 'day').endOf('day').toDate();

      const [thisWeekRows, lastWeekRows] = await Promise.all([
        this._analyticsService.getSnapshots(
          orgId,
          integrationIds,
          thisFrom,
          thisTo
        ),
        this._analyticsService.getSnapshots(
          orgId,
          integrationIds,
          lastFrom,
          lastTo
        ),
      ]);

      // Sum FLOW metrics only — stock metrics (followers) aren't meaningfully
      // summed across a window.
      const isFlow = (metric: string) =>
        (METRIC_REGISTRY[metric]?.kind ?? 'flow') !== 'stock';

      const sumByMetric = (
        rows: { metric: string; value: number }[]
      ): Map<string, number> => {
        const m = new Map<string, number>();
        for (const r of rows) {
          if (!isFlow(r.metric)) continue;
          m.set(r.metric, (m.get(r.metric) || 0) + r.value);
        }
        return m;
      };

      const thisByMetric = sumByMetric(thisWeekRows);
      const lastByMetric = sumByMetric(lastWeekRows);

      const metrics = Array.from(thisByMetric.entries())
        .map(([metric, thisWeek]) => {
          const lastWeek = lastByMetric.get(metric) || 0;
          const changePct =
            lastWeek > 0
              ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
              : null;
          return {
            metric,
            label: METRIC_REGISTRY[metric]?.label || metric,
            thisWeek,
            lastWeek,
            changePct,
          };
        })
        .sort((a, b) => b.thisWeek - a.thisWeek);

      // Best channel: largest summed flow value this week.
      const byIntegration = new Map<string, number>();
      for (const r of thisWeekRows) {
        if (!isFlow(r.metric)) continue;
        byIntegration.set(
          r.integrationId,
          (byIntegration.get(r.integrationId) || 0) + r.value
        );
      }
      let bestChannel: WeeklyAnalyticsSummary['bestChannel'] = null;
      for (const [integrationId, total] of byIntegration.entries()) {
        if (!bestChannel || total > bestChannel.total) {
          bestChannel = {
            integrationId,
            name: nameById.get(integrationId) || 'a channel',
            total,
          };
        }
      }

      // Top post on the headline metric (largest this-week total).
      let topPost: WeeklyAnalyticsSummary['topPost'] = null;
      const headline = metrics[0]?.metric;
      if (headline) {
        try {
          const topPosts =
            await this._analyticsService.getMetricDetailTopPosts(
              orgId,
              integrationIds,
              headline,
              thisFrom,
              thisTo
            );
          const top = topPosts[0];
          if (top) {
            const content = (top as any).post?.content as string | undefined;
            const title = content
              ? stripHtmlTags(content).slice(0, 80).trim()
              : '';
            topPost = { postId: top.postId, title, metric: headline, value: top.value };
          }
        } catch {
          // top post is best-effort — never block the summary on it
        }
      }

      // One-line anomaly recap (best-effort; skip gracefully on any read failure).
      let anomalyRecap: string | null = null;
      try {
        const anomalies = await this._analyticsService.listAnomalies(orgId, {
          limit: 5,
        });
        const weekAnoms = anomalies.filter((a: any) =>
          dayjs(a.createdAt).isAfter(dayjs(thisFrom))
        );
        if (weekAnoms.length > 0) {
          anomalyRecap = `${weekAnoms.length} analytics alert${
            weekAnoms.length === 1 ? '' : 's'
          } flagged this week`;
        }
      } catch {
        // anomaly recap is optional — a missing/failing read just drops the line
      }

      const summary: WeeklyAnalyticsSummary = {
        orgId,
        weekStart: thisFrom,
        weekEnd: thisTo,
        metrics,
        topPost,
        bestChannel,
        anomalyRecap,
        hasData: metrics.length > 0,
      };

      if (summary.hasData) {
        try {
          await this._notificationService.notifyWeeklyAnalyticsSummary({
            orgId,
            metrics: metrics.slice(0, 3).map((m) => ({
              label: m.label,
              thisWeek: m.thisWeek,
              changePct: m.changePct,
            })),
            topPostTitle: topPost?.title || undefined,
            bestChannelName: bestChannel?.name,
            anomalyRecap: anomalyRecap || undefined,
          });
        } catch (err) {
          this.logger.warn('notifyWeeklyAnalyticsSummary failed', {
            error: (err as Error)?.message,
          });
        }
      }

      return summary;
    } catch (err) {
      this.logger.error('buildWeeklySummary error:', {
        error: (err as Error)?.message,
      });
      return null;
    }
  }

  async backfillIntegration(payload: {
    integrationId: string;
    organizationId: string;
  }): Promise<void> {
    const { integrationId, organizationId } = payload;

    const integration = decryptIntegrationTokens(
      await this._analyticsService.findIntegrationByIdRaw(
        integrationId,
        organizationId
      )
    );
    if (!integration || integration.type !== 'social') return;

    await this._orgProviderConfigManager.ensureFresh(integration.organizationId);

    const provider = this._integrationManager.getSocialIntegrationUnchecked(
      integration.providerIdentifier,
      integration.providerVersion ?? undefined
    );
    if (!provider?.analytics) return;

    let token = integration.token;
    if (
      integration.tokenExpiration &&
      dayjs(integration.tokenExpiration).isBefore(dayjs())
    ) {
      const refreshed = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refreshed || !refreshed.accessToken) return;
      token = refreshed.accessToken;
      if (provider.refreshWait) {
        await timer(10000);
      }
    }

    const backfillRows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[] = [];

    try {
      const clientInformation = await this._integrationManager.requireClientInformation(
        integration.providerIdentifier,
        integration.organizationId,
        integration.providerConfigId
      ).catch(() => undefined);

      const data = await provider.analytics(integration.internalId, token, 90, clientInformation);

      for (const entry of data) {
        const canonical = normalizeMetric(
          integration.providerIdentifier,
          entry.label
        );
        if (!canonical) continue;

        for (const point of entry.data) {
          const val = parseFloat(String(point.total));
          if (isNaN(val)) continue;

          backfillRows.push({
            organizationId: integration.organizationId,
            integrationId: integration.id,
            metric: canonical,
            value: val,
            date: dayjs(point.date).startOf('day').toDate(),
          });
        }
      }

      if (backfillRows.length > 0) {
        await this._analyticsService.upsertChannelSnapshots(backfillRows);
      }
    } catch (err: any) {
      if (err instanceof RefreshToken) return;
      this.logger.error(`AnalyticsActivity: Error backfilling ${integration.id}:`, {
        integrationId: integration.id, providerId: integration.providerIdentifier, error: err?.message,
      });
    }
  }

  async probeWatchedAccounts(orgId: string): Promise<void> {
    try {
      const accounts = await this._watchlistService.getEnabledAccounts(orgId);
      for (const account of accounts) {
        try {
          const capabilities =
            PROVIDER_CAPABILITIES[
              account.provider as keyof typeof PROVIDER_CAPABILITIES
            ];
          if (!capabilities?.watchlist) {
            await this._watchlistService.markProbeFailed(
              account.id,
              orgId,
              `Watchlist probes are not supported for ${account.provider}`
            );
            continue;
          }

          await this._watchlistService.probeAndRecord({
            watchedAccountId: account.id,
            organizationId: orgId,
            provider: account.provider,
            handle: account.handle,
            metric: 'followers',
          });
        } catch (err: any) {
          this.logger.error(
            `AnalyticsActivity: watchlist probe failed for ${account.provider}:${account.handle}`,
            { error: err?.message }
          );
          await this._watchlistService.markProbeFailed(
            account.id,
            orgId,
            err?.message || 'Probe failed'
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `AnalyticsActivity: probeWatchedAccounts failed for org ${orgId}`,
        { error: err?.message }
      );
    }
  }

  async collectShortLinkSnapshots(orgId: string): Promise<void> {
    const active = await this._shortLinkSettingsService.getActiveProvider(orgId);
    if (!active) return;

    let adapter;
    try {
      adapter = this._resolution.resolveShortLink(active.identifier, {
        version: active.version ?? 'v1',
        credentials: active.credentials || {},
        orgId,
      });
    } catch {
      return;
    }
    if (!adapter) return;
    if (!adapter.capabilities.statistics) return;
    if (!adapter.linkStatistics) return;

    const links = await this._shortLinkSettingsService.getLinksForOrg(orgId);
    if (links.length === 0) return;

    const batchSize = 20;
    const today = dayjs().startOf('day').toDate();

    try {
      for (let i = 0; i < links.length; i += batchSize) {
        const batch = links.slice(i, i + batchSize);
        const shortUrls = batch.map((l) => l.shortUrl);

        try {
          const stats = await adapter.linkStatistics(
            {
              orgId,
              credentials: active.credentials || {},
              customDomain: active.customDomain || undefined,
            },
            shortUrls,
          );

          const rows: {
            shortLinkId: string;
            organizationId: string;
            date: Date;
            clicks: number;
          }[] = [];
          for (const stat of stats) {
            const link = batch.find((l) => l.shortUrl === stat.short);
            if (!link) continue;
            rows.push({
              shortLinkId: link.id,
              organizationId: orgId,
              date: today,
              clicks: parseInt(stat.clicks, 10) || 0,
            });
          }

          // N6: one transaction per batch instead of one upsert per link.
          await this._shortLinkSettingsService.upsertSnapshotsBatch(rows);
        } catch (err) {
          this.logger.warn(
            `AnalyticsActivity: short-link snapshot batch failed for org ${orgId}, provider ${active.identifier}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `AnalyticsActivity: short-link snapshot collection failed for org ${orgId}: ${(err as Error).message}`,
      );
    }
  }

  async pruneShortLinkSnapshots(orgId: string): Promise<void> {
    const retentionDays = getRetentionDays('ANALYTICS_POST_RETENTION_DAYS', 90);

    const before = dayjs().subtract(retentionDays, 'day').startOf('day').toDate();
    await this._shortLinkSettingsService.pruneSnapshots(orgId, before);
  }

  async pruneEmailLogs(): Promise<void> {
    const days = (() => {
      const raw = process.env.EMAIL_LOG_RETENTION_DAYS;
      if (raw === undefined || raw === '') return 90;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return 90;
      return Math.floor(parsed);
    })();
    await this._emailLogService.prune(days);
  }
}
