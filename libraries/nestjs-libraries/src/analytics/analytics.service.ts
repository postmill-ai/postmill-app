import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  AnalyticsMetricDetailResponse,
  AnalyticsOverviewResponse,
  SnapshotLike,
} from './analytics.types';
import {
  aggregateSnapshots,
  buildFilledDayMap,
  buildPrevMap,
  buildSeries,
  buildSparkline,
  computePercentageChange,
  getMetricDef,
} from './analytics-aggregation';
import { AnalyticsLiveFallbackService } from './analytics-live-fallback';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsDetailService } from './analytics-detail.service';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsExportService } from './analytics-export.service';
import {
  detectAnomaly,
  DEFAULT_ANOMALY_FLOORS,
  MetricKind,
} from './anomaly.detection';
import { getRetentionDays } from './analytics-aggregation';
import { METRIC_REGISTRY } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { stripHtmlTags } from '@gitroom/helpers/utils/strip.tags';

dayjs.extend(isoWeek);

// Retention defaults: keep raw daily channel snapshots for ~18 months, then
// roll them up to one weekly row per (integration, metric). Per-post daily
// snapshots are pruned (not archived) beyond the post-tracking window.
// Both are overridable via env (read per-run so config changes don't require
// a restart): ANALYTICS_DAILY_RETENTION_DAYS / ANALYTICS_POST_RETENTION_DAYS.
const DEFAULT_DAILY_RETENTION_DAYS = 548; // ~18 months
const DEFAULT_POST_RETENTION_DAYS = 90;
// R1.8: the post rollup only re-reads/deletes/re-creates rows within this
// window below the post-retention cutoff each sweep (instead of the org's entire
// pre-cutoff history). Chronological aging guarantees every week receiving newly
// aged dailies has its weekly row (dated startOf('isoWeek')) inside the window,
// so bounded delete+recreate stays correct and — with R1.7 latest-wins —
// idempotent. Rows that miss the window after a >30-day sweep outage stay daily.
const POST_ROLLUP_LOOKBACK_DAYS = 30;

// Float env reader (for ANALYTICS_ANOMALY_Z) — invalid/≤0 falls back.
function envFloat(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    Logger.warn(
      `AnalyticsService: invalid ${envKey}="${raw}", falling back to ${fallback}`
    );
    return fallback;
  }
  return parsed;
}

// Re-export the shared shapes from their extracted home so existing callers
// (controllers, chat tools) that import them from this module keep working.
export {
  KpiItem,
  ByChannelItem,
  MetricSeries,
  AnalyticsOverviewResponse,
  AnalyticsMetricDetailResponse,
  SnapshotLike,
  BestTimeEntry,
} from './analytics.types';

// AnalyticsService is the injected FACADE for the v2 analytics engine. The
// compute is split across sibling services (5.3) — overview/channel/posts,
// metric/day/channel drill-downs, insights, export, and live-fallback — plus a
// pure aggregation module. This class stays the single injection point that
// controllers, campaigns.controller, and the chat analytics tools use; it only
// delegates. Behaviour and public method signatures are unchanged.
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private analyticsRepository: AnalyticsRepository,
    private _orgShortLinkSettingsService: OrgShortLinkSettingsService,
    private overviewService: AnalyticsOverviewService,
    private detailService: AnalyticsDetailService,
    private insightsService: AnalyticsInsightsService,
    private exportService: AnalyticsExportService,
    private liveFallbackService: AnalyticsLiveFallbackService,
    private _webhooksService: WebhooksService,
    private _notificationService: NotificationService,
  ) {}

  // ── Pure aggregation helpers (retained as thin private delegators so the
  //    spec's `(service as any).<helper>(...)` reaches remain valid) ──

  private getMetricDef(metric: string) {
    return getMetricDef(metric);
  }

  private computePercentageChange(
    current: number,
    previous: number | null,
    format: string
  ): number | null {
    return computePercentageChange(current, previous, format);
  }

  private aggregateSnapshots(
    snapshots: { integrationId: string; metric: string; value: number; date: Date }[],
    metric: string
  ) {
    return aggregateSnapshots(snapshots, metric);
  }

  private buildFilledDayMap(
    snapshots: { date: Date; metric: string; value: number; integrationId: string }[],
    metric: string,
    from: Date,
    to: Date,
    kind: string,
    dateOffset: number
  ): Record<string, number> {
    return buildFilledDayMap(snapshots, metric, from, to, kind, dateOffset);
  }

  private buildSparkline(
    snapshots: { date: Date; metric: string; value: number; integrationId: string }[],
    metric: string,
    from: Date,
    to: Date
  ) {
    return buildSparkline(snapshots, metric, from, to);
  }

  private buildSeries(
    snapshots: { date: Date; metric: string; value: number; integrationId: string }[],
    from: Date,
    to: Date
  ) {
    return buildSeries(snapshots, from, to);
  }

  private buildPrevMap(
    snapshots: { date: Date; metric: string; value: number; integrationId: string }[],
    prevFrom: Date,
    prevTo: Date,
    dateOffset: number
  ): Record<string, Record<string, number>> {
    return buildPrevMap(snapshots, prevFrom, prevTo, dateOffset);
  }

  private escapeCSVField(value: string): string {
    return this.exportService.escapeCSVField(value);
  }

  // ── Live-fallback delegators (retained for the spec's `(service as any)` reaches) ──

  private async checkCoverage(
    orgId: string,
    dbIntegrations: { id: string; providerIdentifier: string; providerVersion?: string | null }[],
    from: Date,
    to: Date
  ): Promise<number> {
    return this.liveFallbackService.checkCoverage(orgId, dbIntegrations, from, to);
  }

  private async fetchLiveFallback(
    org: Organization,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    return this.liveFallbackService.fetchLiveFallback(org, integrationIds, from, to);
  }

  private convertLiveToSnapshots(
    providerData: Record<string, any[]>,
    orgId: string,
    integrationMap: Record<string, string>,
    from: Date,
    to: Date
  ) {
    return this.liveFallbackService.convertLiveToSnapshots(
      providerData,
      orgId,
      integrationMap,
      from,
      to
    );
  }

  // ── Overview / channel / posts / post-detail ──

  async getOverview(
    org: Organization,
    from: string,
    to: string,
    integrations: string[],
    compare: boolean,
    opts: { campaignIds?: string[] } = {}
  ): Promise<AnalyticsOverviewResponse> {
    return this.overviewService.getOverview(org, from, to, integrations, compare, opts);
  }

  async getChannel(
    org: Organization,
    integrationId: string,
    from: string,
    to: string,
    compare: boolean
  ) {
    return this.overviewService.getChannel(org, integrationId, from, to, compare);
  }

  async getPosts(
    org: Organization,
    from: string,
    to: string,
    integrationIds: string[],
    sort?: string,
    dir?: string,
    page?: number,
    limit?: number,
    opts: { campaignIds?: string[] } = {}
  ) {
    return this.overviewService.getPosts(
      org, from, to, integrationIds, sort, dir, page, limit, opts
    );
  }

  async getPostDetail(org: Organization, postId: string, date?: string) {
    return this.overviewService.getPostDetail(org, postId, date);
  }

  // ── Metric / day / channel drill-downs ──

  async getMetricDetail(
    org: Organization,
    metric: string,
    from: string,
    to: string,
    integrationIds: string[],
    compare: boolean,
    opts: { campaignIds?: string[] } = {}
  ): Promise<AnalyticsMetricDetailResponse> {
    return this.detailService.getMetricDetail(
      org, metric, from, to, integrationIds, compare, opts
    );
  }

  async getDayDetail(
    org: Organization,
    date: string,
    metric: string,
    integrationIds: string[],
    opts: { campaignIds?: string[] } = {}
  ) {
    return this.detailService.getDayDetail(org, date, metric, integrationIds, opts);
  }

  async getChannelMetric(
    org: Organization,
    integrationId: string,
    metric: string,
    from: string,
    to: string,
    compare: boolean
  ) {
    return this.detailService.getChannelMetric(
      org, integrationId, metric, from, to, compare
    );
  }

  // ── Export ──

  async exportData(
    org: Organization,
    from: string,
    to: string,
    integrationIds: string[],
    format: string,
    compare: boolean = false,
    opts: { campaignIds?: string[] } = {}
  ) {
    const overview = await this.overviewService.getOverview(
      org,
      from,
      to,
      integrationIds,
      compare,
      opts
    );
    return this.exportService.toExport(overview, format);
  }

  // ── Insights (best-time + recommendations) ──

  async getBestTimeAnalyticsContext(orgId: string) {
    return this.insightsService.getBestTimeAnalyticsContext(orgId);
  }

  async getRecommendations(org: Organization) {
    return this.insightsService.getRecommendations(org);
  }

  async getBestTimeData(orgId: string, integrationIds?: string[], tz?: string) {
    return this.insightsService.getBestTimeData(orgId, integrationIds, tz);
  }

  // ── 6.3: competitor overlay — own-channel follower series ──
  async getFollowerSeries(orgId: string, from: string, to: string) {
    return this.insightsService.getFollowerSeries(orgId, from, to);
  }

  // ── 6.6: data-health panel ──
  async getDataHealth(org: Organization) {
    return this.overviewService.getDataHealth(org);
  }

  // ── 6.7: on-demand channel refresh ──
  async refreshChannel(org: Organization, integrationId: string) {
    return this.overviewService.refreshChannel(org, integrationId);
  }

  // ── 7.4: content-attribute intelligence ──
  async getContentInsights(org: Organization) {
    return this.insightsService.getContentInsights(org);
  }

  // ── 7.5: LLM-narrated summary (no-provider rule enforced in the service) ──
  async narrate(org: Organization, from: string, to: string) {
    return this.insightsService.narrate(org, from, to);
  }

  // ── Short-link pass-throughs ──

  async getLinksForOrg(orgId: string) {
    return this._orgShortLinkSettingsService.getLinksForOrg(orgId);
  }

  async getAggregatedClicks(orgId: string, from: Date, to: Date) {
    return this._orgShortLinkSettingsService.getAggregatedClicks(orgId, from, to);
  }

  // ── Short-link aggregation (A-03) ──

  async getShortLinks(orgId: string, from: Date, to: Date) {
    const [links, snapshots] = await Promise.all([
      this._orgShortLinkSettingsService.getLinksForOrg(orgId),
      this._orgShortLinkSettingsService.getAggregatedClicks(orgId, from, to),
    ]);

    const clickMap = new Map<string, number>();
    for (const snap of snapshots) {
      const current = clickMap.get(snap.shortLinkId) || 0;
      clickMap.set(snap.shortLinkId, current + snap.clicks);
    }

    return links.map((link) => ({
      id: link.id,
      shortUrl: link.shortUrl,
      originalUrl: link.originalUrl,
      provider: link.provider,
      clicks: clickMap.get(link.id) || 0,
      createdAt: link.createdAt,
    }));
  }

  async getShortLinkTimeseries(orgId: string, from: Date, to: Date) {
    const snapshots = await this._orgShortLinkSettingsService.getAggregatedClicks(
      orgId,
      from,
      to
    );

    const dateMap = new Map<string, number>();
    for (const snap of snapshots) {
      const dateKey = dayjs(snap.date).format('YYYY-MM-DD');
      const current = dateMap.get(dateKey) || 0;
      dateMap.set(dateKey, current + snap.clicks);
    }

    return Array.from(dateMap.entries())
      .map(([date, clicks]) => ({ date, clicks }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── AnalyticsActivity pass-throughs (A-21) ──
  // These are the raw ledger/sweep operations that previously lived in
  // AnalyticsActivity. They are intentionally thin delegates so the activity
  // does not import the repository directly.

  async upsertChannelSnapshots(
    rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    if (rows.length === 0) return;
    return this.analyticsRepository.upsertChannelSnapshots(rows);
  }

  async findPostsForSnapshots(
    orgId: string,
    since: Date,
    take = 500,
    cursor?: string,
  ) {
    return this.analyticsRepository.findPostsForSnapshots(orgId, since, take, cursor);
  }

  async upsertPostSnapshots(
    rows: {
      organizationId: string;
      postId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    if (rows.length === 0) return;
    return this.analyticsRepository.upsertPostSnapshots(rows);
  }

  async getLatestPostSnapshots(orgId: string, postIds: string[], metrics: string[]) {
    return this.analyticsRepository.getLatestPostSnapshots(orgId, postIds, metrics);
  }

  async updatePostCounters(
    orgId: string,
    postId: string,
    data: { lastViews?: number; lastLikes?: number; lastComments?: number },
  ) {
    return this.analyticsRepository.updatePostCounters(orgId, postId, data);
  }

  async getBestTimeIntegrations(orgId: string) {
    return this.analyticsRepository.getBestTimeIntegrations(orgId);
  }

  async getSnapshots(orgId: string, integrationIds: string[], from: Date, to: Date) {
    return this.analyticsRepository.getSnapshots(orgId, integrationIds, from, to);
  }

  async getMetricDetailTopPosts(
    orgId: string,
    integrationIds: string[],
    metric: string,
    from: Date,
    to: Date,
  ) {
    return this.analyticsRepository.getMetricDetailTopPosts(
      orgId,
      integrationIds,
      metric,
      from,
      to,
    );
  }

  async findIntegrationByIdRaw(integrationId: string, organizationId: string) {
    return this.analyticsRepository.findIntegrationByIdRaw(
      integrationId,
      organizationId,
    );
  }

  async getSnapshotsForOrgSince(orgId: string, from: Date) {
    return this.analyticsRepository.getSnapshotsForOrgSince(orgId, from);
  }

  async getDayPostSnapshotsForGroups(
    orgId: string,
    groups: { integrationId: string; metric: string }[],
    dateStart: Date,
    dateEnd: Date,
  ) {
    return this.analyticsRepository.getDayPostSnapshotsForGroups(
      orgId,
      groups,
      dateStart,
      dateEnd,
    );
  }

  async getDayPostSnapshots(
    orgId: string,
    integrationIds: string[],
    metric: string,
    dateStart: Date,
    dateEnd: Date,
  ) {
    return this.analyticsRepository.getDayPostSnapshots(
      orgId,
      integrationIds,
      metric,
      dateStart,
      dateEnd,
    );
  }

  async getRecentAnomaly(
    orgId: string,
    integrationId: string,
    metric: string,
    direction: string,
    sinceDate: Date,
  ) {
    return this.analyticsRepository.getRecentAnomaly(
      orgId,
      integrationId,
      metric,
      direction,
      sinceDate,
    );
  }

  async getEnabledAlertRules(orgId: string) {
    return this.analyticsRepository.getEnabledAlertRules(orgId);
  }

  async createAnomaliesAndStampRules(
    rows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      date: Date;
      value: number;
      baseline: number;
      deviation: number;
      direction: string;
      topPostId?: string | null;
      ruleId?: string | null;
      notifiedAt?: Date | null;
    }[],
    orgId: string,
    ruleIds: string[],
    lastFiredAt: Date,
  ) {
    return this.analyticsRepository.createAnomaliesAndStampRules(
      rows,
      orgId,
      ruleIds,
      lastFiredAt,
    );
  }

  async countPostSnapshotsBeforeFloor(orgId: string, floor: Date) {
    return this.analyticsRepository.countPostSnapshotsBeforeFloor(orgId, floor);
  }

  async findPostSnapshotsBefore(orgId: string, floor: Date, cutoff: Date) {
    return this.analyticsRepository.findPostSnapshotsBefore(orgId, floor, cutoff);
  }

  async replaceRolledUpPostSnapshots(
    orgId: string,
    floor: Date,
    cutoff: Date,
    weeklyRows: {
      organizationId: string;
      postId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    return this.analyticsRepository.replaceRolledUpPostSnapshots(
      orgId,
      floor,
      cutoff,
      weeklyRows,
    );
  }

  async findChannelSnapshotsBefore(orgId: string, cutoff: Date) {
    return this.analyticsRepository.findChannelSnapshotsBefore(orgId, cutoff);
  }

  async replaceRolledUpSnapshots(
    orgId: string,
    dailyCutoff: Date,
    weeklyRows: {
      organizationId: string;
      integrationId: string;
      metric: string;
      value: number;
      date: Date;
    }[],
  ) {
    return this.analyticsRepository.replaceRolledUpSnapshots(
      orgId,
      dailyCutoff,
      weeklyRows,
    );
  }

  async pruneAndRollupSnapshots(orgId: string): Promise<void> {
    const dailyCutoff = dayjs()
      .subtract(
        getRetentionDays(
          'ANALYTICS_DAILY_RETENTION_DAYS',
          DEFAULT_DAILY_RETENTION_DAYS
        ),
        'day'
      )
      .startOf('day')
      .toDate();
    const postCutoff = dayjs()
      .subtract(
        getRetentionDays(
          'ANALYTICS_POST_RETENTION_DAYS',
          DEFAULT_POST_RETENTION_DAYS
        ),
        'day'
      )
      .startOf('day')
      .toDate();

    // 1. Roll up post snapshots older than the post-retention window into one
    //    weekly row per (postId, metric, ISO week) — always the week's LATEST
    //    known level (R1.7), because PostAnalyticsSnapshot.value is a cumulative
    //    lifetime level for every metric (not a per-window flow). A weekly row is
    //    then simply the week's last level, and the read-time level-differencing
    //    keeps working across the daily→weekly granularity seam with no special
    //    cases. Bounded below by `postFloor` (R1.8) so the sweep only compacts a
    //    fixed recent window, not the org's whole pre-cutoff history. Same atomic
    //    delete+createMany-in-$transaction machinery as the channel rollup below.
    const postFloor = dayjs(postCutoff)
      .subtract(POST_ROLLUP_LOOKBACK_DAYS, 'day')
      .startOf('day')
      .toDate();

    // No silent truncation: report rows aging past the bounded window (they stay
    // daily and still aggregate correctly as levels — only compaction is missed).
    const skippedBelowFloor =
      await this.analyticsRepository.countPostSnapshotsBeforeFloor(
        orgId,
        postFloor
      );
    if (skippedBelowFloor > 0) {
      this.logger.warn(
        `AnalyticsActivity: ${skippedBelowFloor} post snapshot(s) older than the rollup floor were left un-compacted (org ${orgId})`
      );
    }

    const oldPostRows = await this.analyticsRepository.findPostSnapshotsBefore(
      orgId,
      postFloor,
      postCutoff
    );
    if (oldPostRows.length) {
      const postGroups = new Map<
        string,
        {
          postId: string;
          integrationId: string;
          metric: string;
          weekStart: Date;
          latestDate: Date;
          latestValue: number;
        }
      >();

      for (const row of oldPostRows) {
        const weekStart = dayjs(row.date)
          .startOf('isoWeek')
          .startOf('day')
          .toDate();
        const key = `${row.postId}|${row.metric}|${weekStart.getTime()}`;
        const existing = postGroups.get(key);
        if (!existing) {
          postGroups.set(key, {
            postId: row.postId,
            integrationId: row.integrationId,
            metric: row.metric,
            weekStart,
            latestDate: row.date,
            latestValue: row.value,
          });
          continue;
        }
        if (dayjs(row.date).isAfter(dayjs(existing.latestDate))) {
          existing.latestDate = row.date;
          existing.latestValue = row.value;
        }
      }

      const weeklyPostRows = Array.from(postGroups.values()).map((g) => ({
        organizationId: orgId,
        postId: g.postId,
        integrationId: g.integrationId,
        metric: g.metric,
        // R1.7: levels — always the week's last known value, every metric.
        value: g.latestValue,
        date: g.weekStart,
      }));

      await this.analyticsRepository.replaceRolledUpPostSnapshots(
        orgId,
        postFloor,
        postCutoff,
        weeklyPostRows
      );
    }

    // 2. Roll up channel snapshots older than the daily-retention window into
    //    a single weekly row per (integration, metric, ISO week): flow metrics
    //    are summed, stock metrics keep the latest value in the week.
    const oldRows = await this.analyticsRepository.findChannelSnapshotsBefore(
      orgId,
      dailyCutoff
    );
    if (!oldRows.length) {
      return;
    }

    const groups = new Map<
      string,
      {
        integrationId: string;
        metric: string;
        weekStart: Date;
        sum: number;
        latestDate: Date;
        latestValue: number;
      }
    >();

    for (const row of oldRows) {
      const weekStart = dayjs(row.date).startOf('isoWeek').startOf('day').toDate();
      const key = `${row.integrationId}|${row.metric}|${weekStart.getTime()}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          integrationId: row.integrationId,
          metric: row.metric,
          weekStart,
          sum: row.value,
          latestDate: row.date,
          latestValue: row.value,
        });
        continue;
      }
      existing.sum += row.value;
      if (dayjs(row.date).isAfter(dayjs(existing.latestDate))) {
        existing.latestDate = row.date;
        existing.latestValue = row.value;
      }
    }

    const weeklyRows = Array.from(groups.values()).map((g) => {
      const def = METRIC_REGISTRY[g.metric];
      const value = def?.kind === 'stock' ? g.latestValue : g.sum;
      return {
        organizationId: orgId,
        integrationId: g.integrationId,
        metric: g.metric,
        value,
        date: g.weekStart,
      };
    });

    // Replace the rolled-up daily rows with their weekly aggregates atomically.
    // Re-running is idempotent: a weekly row dated on its own week-start
    // collapses to itself, and newly-aged days fold into the existing weekly row.
    await this.analyticsRepository.replaceRolledUpSnapshots(
      orgId,
      dailyCutoff,
      weeklyRows
    );
  }

  async detectAnomalies(orgId: string): Promise<void> {
    try {
      const z = envFloat('ANALYTICS_ANOMALY_Z', 3);
      const cooldownDays = getRetentionDays('ANALYTICS_ANOMALY_COOLDOWN_DAYS', 3);

      const since = dayjs().subtract(35, 'day').startOf('day').toDate();
      const loaded =
        await this.analyticsRepository.getSnapshotsForOrgSince(orgId, since);
      // Exclude today's rows: the 02:00 UTC sweep upserts a ~2-hour PARTIAL day
      // for flow metrics, and testing that partial against a 28-full-day
      // baseline systematically fires false "drop" alerts. Yesterday is the
      // newest complete day — it becomes the candidate for the detector AND for
      // alert-rule evaluation (both read the series' last point).
      const todayStart = dayjs().startOf('day');
      const snapshots = loaded.filter((s) =>
        dayjs(s.date).isBefore(todayStart)
      );
      if (snapshots.length === 0) return;

      const integrations =
        await this.analyticsRepository.getBestTimeIntegrations(orgId);
      const intById = new Map(integrations.map((i) => [i.id, i]));

      // Group by (integrationId, metric).
      const groups = new Map<
        string,
        { integrationId: string; metric: string; series: { date: Date; value: number }[] }
      >();
      for (const s of snapshots) {
        const key = `${s.integrationId}::${s.metric}`;
        let g = groups.get(key);
        if (!g) {
          g = { integrationId: s.integrationId, metric: s.metric, series: [] };
          groups.set(key, g);
        }
        g.series.push({ date: s.date, value: s.value });
      }

      const cooldownFrom = dayjs()
        .subtract(cooldownDays, 'day')
        .startOf('day')
        .toDate();

      type Pending = {
        row: {
          organizationId: string;
          integrationId: string;
          metric: string;
          date: Date;
          value: number;
          baseline: number;
          deviation: number;
          direction: string;
          topPostId?: string | null;
          ruleId?: string | null;
          notifiedAt?: Date | null;
        };
        canNotify: boolean;
        integrationName: string;
        topPostTitle?: string;
      };
      const pending: Pending[] = [];

      type FiredGroup = {
        integrationId: string;
        metric: string;
        candidateDate: Date;
        result: {
          value: number;
          baseline: number;
          deviation: number;
          direction: string;
        };
      };
      const fired: FiredGroup[] = [];

      for (const g of groups.values()) {
        const def = METRIC_REGISTRY[g.metric];
        const kind: MetricKind = def?.kind === 'stock' ? 'stock' : 'flow';
        const result = detectAnomaly(g.series, kind, {
          z,
          floor: DEFAULT_ANOMALY_FLOORS[kind],
        });
        if (!result) continue;

        fired.push({
          integrationId: g.integrationId,
          metric: g.metric,
          candidateDate: g.series[g.series.length - 1].date,
          result,
        });
      }

      // Root-cause hint (4.9): batch-read the top post for every fired group in
      // one query (ANALYTICS-06). Falls back to one query per group when the
      // batch method is unavailable (e.g. older test mocks).
      const rootCauseByGroup = new Map<
        string,
        { topPostId: string | null; topPostTitle?: string }
      >();
      if (fired.length > 0) {
        if (
          typeof this.analyticsRepository.getDayPostSnapshotsForGroups ===
          'function'
        ) {
          try {
            const starts = fired.map((f) => dayjs(f.candidateDate).startOf('day'));
            const ends = fired.map((f) => dayjs(f.candidateDate).endOf('day'));
            const dayStart = starts
              .reduce((min, d) => (d.isBefore(min) ? d : min))
              .toDate();
            const dayEnd = ends
              .reduce((max, d) => (d.isAfter(max) ? d : max))
              .toDate();
            const allDayPosts =
              await this.analyticsRepository.getDayPostSnapshotsForGroups(
                orgId,
                fired.map((f) => ({
                  integrationId: f.integrationId,
                  metric: f.metric,
                })),
                dayStart,
                dayEnd
              );

            const firedMap = new Map(
              fired.map((f) => [`${f.integrationId}::${f.metric}`, f])
            );
            const grouped = new Map<string, typeof allDayPosts>();
            for (const row of allDayPosts) {
              const key = `${row.integrationId}::${row.metric}`;
              const fg = firedMap.get(key);
              if (
                !fg ||
                !dayjs(row.date).isSame(dayjs(fg.candidateDate), 'day')
              ) {
                continue;
              }
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(row);
            }

            for (const fg of fired) {
              const key = `${fg.integrationId}::${fg.metric}`;
              const rows = grouped.get(key) || [];
              if (rows.length === 0) continue;
              const top = rows.reduce((a, b) =>
                b.value > a.value ? b : a
              );
              const content = (top as any).post?.content as
                | string
                | undefined;
              rootCauseByGroup.set(key, {
                topPostId: top.postId,
                topPostTitle: content
                  ? stripHtmlTags(content).slice(0, 80).trim()
                  : undefined,
              });
            }
          } catch {
            // root-cause is best-effort; never block an anomaly on it
          }
        } else {
          // P-03: the batched `getDayPostSnapshotsForGroups` path above is the
          // production default (single OR-ed query). This per-group fallback is
          // retained only for older repository mocks/test fixtures that do not
          // implement the batch method; it is best-effort and never blocks the
          // anomaly detection pipeline.
          for (const fg of fired) {
            try {
              const dayStart = dayjs(fg.candidateDate).startOf('day').toDate();
              const dayEnd = dayjs(fg.candidateDate).endOf('day').toDate();
              const dayPosts = await this.analyticsRepository.getDayPostSnapshots(
                orgId,
                [fg.integrationId],
                fg.metric,
                dayStart,
                dayEnd
              );
              if (dayPosts.length > 0) {
                const top = dayPosts.reduce((a, b) =>
                  b.value > a.value ? b : a
                );
                const content = (top as any).post?.content as
                  | string
                  | undefined;
                rootCauseByGroup.set(`${fg.integrationId}::${fg.metric}`, {
                  topPostId: top.postId,
                  topPostTitle: content
                    ? stripHtmlTags(content).slice(0, 80).trim()
                    : undefined,
                });
              }
            } catch {
              // root-cause is best-effort
            }
          }
        }
      }

      for (const fg of fired) {
        const key = `${fg.integrationId}::${fg.metric}`;
        const rc = rootCauseByGroup.get(key);

        const recent = await this.analyticsRepository.getRecentAnomaly(
          orgId,
          fg.integrationId,
          fg.metric,
          fg.result.direction,
          cooldownFrom,
        );

        pending.push({
          row: {
            organizationId: orgId,
            integrationId: fg.integrationId,
            metric: fg.metric,
            date: fg.candidateDate,
            value: fg.result.value,
            baseline: fg.result.baseline,
            deviation: fg.result.deviation,
            direction: fg.result.direction,
            topPostId: rc?.topPostId ?? null,
          },
          canNotify: !recent,
          integrationName:
            intById.get(fg.integrationId)?.name || 'a channel',
          topPostTitle: rc?.topPostTitle,
        });
      }

      // ── 7.3: evaluate user-defined alert rules against the SAME loaded
      //    snapshots, after the automatic detector. A fired rule writes an
      //    AnalyticsAnomaly row (ruleId set) and folds into the same
      //    notification cap+cooldown pipeline below. Cooldown is the rule's own
      //    `lastFiredAt` (reusing the anomaly cooldown window) so a rule can't
      //    re-fire day after day; firing sets `lastFiredAt`. Non-fatal: a rule
      //    read/eval failure must not abort the sweep.
      const firedRuleIds = new Set<string>();
      try {
        const rules =
          await this.analyticsRepository.getEnabledAlertRules(orgId);
        for (const rule of rules) {
          // Cooldown gate: skip firing while inside the window.
          if (
            rule.lastFiredAt &&
            dayjs(rule.lastFiredAt).isAfter(dayjs(cooldownFrom))
          ) {
            continue;
          }

          for (const g of groups.values()) {
            if (g.metric !== rule.metric) continue;
            if (rule.integrationId && rule.integrationId !== g.integrationId) {
              continue;
            }

            const evaluated = this.evaluateAlertRule(rule, g.series);
            if (!evaluated) continue;

            firedRuleIds.add(rule.id);

            // R4.3: a detector row may already be pending for the SAME
            // @@unique([integrationId, metric, date]) key. Pushing a second row
            // makes createAnomalies' skipDuplicates silently drop the rule row —
            // losing the ruleId attribution while both notifications still fire.
            // Instead, attach the rule to the existing row and ensure it notifies
            // (a user-defined rule fire is always notify-worthy).
            const existing = pending.find(
              (pp) =>
                pp.row.integrationId === g.integrationId &&
                pp.row.metric === g.metric &&
                dayjs(pp.row.date).isSame(dayjs(evaluated.date), 'day')
            );
            if (existing) {
              existing.row.ruleId = rule.id;
              existing.canNotify = true;
              continue;
            }

            pending.push({
              row: {
                organizationId: orgId,
                integrationId: g.integrationId,
                metric: g.metric,
                date: evaluated.date,
                value: evaluated.value,
                baseline: evaluated.baseline,
                deviation: evaluated.deviation,
                direction: evaluated.direction,
                topPostId: null,
                ruleId: rule.id,
              },
              canNotify: true,
              integrationName:
                intById.get(g.integrationId)?.name || 'a channel',
            });
          }
        }
      } catch (err) {
        this.logger.warn('alert-rule evaluation failed', {
          error: (err as Error)?.message,
        });
      }

      if (pending.length === 0) return;

      // Notification cap: 3/org/day, highest |deviation| first. Non-notified
      // anomalies still persist their rows.
      const notifiable = pending
        .filter((p) => p.canNotify)
        .sort((a, b) => Math.abs(b.row.deviation) - Math.abs(a.row.deviation))
        .slice(0, 3);
      const now = new Date();
      for (const p of notifiable) p.row.notifiedAt = now;

      // M-05: persist anomalies and stamp rule lastFiredAt atomically inside a
      // repository $transaction so retries cannot re-notify without stamping.
      try {
        await this.analyticsRepository.createAnomaliesAndStampRules(
          pending.map((p) => p.row),
          orgId,
          Array.from(firedRuleIds),
          now
        );
      } catch (err) {
        this.logger.warn('anomaly persistence + rule stamp transaction failed', {
          error: (err as Error)?.message,
          ruleIds: Array.from(firedRuleIds),
        });
        return;
      }

      // 6.8: dispatch an `analytics.anomaly_detected` webhook for the persisted
      // batch so n8n/Zapier users can automate on spikes/drops. Guarded with the
      // same error-swallowed posture as notifySnapshotComplete — a webhook
      // failure must not skip the in-app notifications below. Only fires when at
      // least one anomaly persisted (pending is non-empty here).
      try {
        await this._webhooksService.dispatchEvent(
          orgId,
          'analytics.anomaly_detected',
          {
            orgId,
            anomalies: pending.map((p) => ({
              integrationId: p.row.integrationId,
              integrationName: p.integrationName,
              metric: p.row.metric,
              direction: p.row.direction,
              value: p.row.value,
              baseline: p.row.baseline,
              deviation: p.row.deviation,
              date: p.row.date,
              topPostId: p.row.topPostId ?? null,
            })),
            timestamp: new Date().toISOString(),
          }
        );
      } catch (err) {
        this.logger.warn('anomaly_detected webhook dispatch failed', {
          error: (err as Error)?.message,
        });
      }

      for (const p of notifiable) {
        try {
          await this._notificationService.notifyAnalyticsAnomaly({
            orgId,
            integrationName: p.integrationName,
            metric: METRIC_REGISTRY[p.row.metric]?.label || p.row.metric,
            metricKey: p.row.metric,
            direction: p.row.direction as 'spike' | 'drop',
            value: p.row.value,
            baseline: p.row.baseline,
            deviation: p.row.deviation,
            integrationId: p.row.integrationId,
            topPostTitle: p.topPostTitle,
          });
        } catch (err) {
          this.logger.warn('notifyAnalyticsAnomaly failed', {
            error: (err as Error)?.message,
            integrationId: p.row.integrationId,
            metric: p.row.metric,
          });
        }
      }
    } catch (err) {
      this.logger.error('detectAnomalies error:', {
        error: (err as Error)?.message,
      });
    }
  }

  private evaluateAlertRule(
    rule: { comparator: string; threshold: number; direction: string },
    series: { date: Date; value: number }[],
  ): {
    date: Date;
    value: number;
    baseline: number;
    deviation: number;
    direction: string;
  } | null {
    if (series.length === 0) return null;
    const latest = series[series.length - 1];
    const t = rule.threshold;

    if (rule.comparator === 'gte' || rule.comparator === 'lte') {
      const fires =
        rule.comparator === 'gte' ? latest.value >= t : latest.value <= t;
      if (!fires) return null;
      return {
        date: latest.date,
        value: latest.value,
        baseline: t,
        deviation: t !== 0 ? (latest.value - t) / t : 0,
        direction: rule.comparator === 'gte' ? 'spike' : 'drop',
      };
    }

    // change_pct: trailing-7-day sum vs the prior-7-day sum.
    const trailingFrom = dayjs(latest.date).subtract(6, 'day').startOf('day');
    const priorFrom = dayjs(latest.date).subtract(13, 'day').startOf('day');
    const priorTo = dayjs(latest.date).subtract(7, 'day').endOf('day');

    let trailing = 0;
    let prior = 0;
    for (const p of series) {
      const d = dayjs(p.date);
      if (!d.isBefore(trailingFrom)) {
        trailing += p.value;
      } else if (!d.isBefore(priorFrom) && !d.isAfter(priorTo)) {
        prior += p.value;
      }
    }

    if (prior <= 0) return null; // no meaningful percent off a zero baseline
    const changePct = ((trailing - prior) / prior) * 100;
    const fires =
      rule.direction === 'down' ? changePct <= -t : changePct >= t;
    if (!fires) return null;

    return {
      date: latest.date,
      value: trailing,
      baseline: prior,
      deviation: changePct / 100,
      direction: rule.direction === 'down' ? 'drop' : 'spike',
    };
  }


  // ── Anomaly alerts (4.8) — thin pass-through to the ledger ──

  async listAnomalies(
    orgId: string,
    opts: { limit?: number; includeDismissed?: boolean } = {},
  ) {
    return this.analyticsRepository.listAnomalies(orgId, opts);
  }

  async dismissAnomaly(orgId: string, id: string): Promise<{ success: boolean }> {
    const res = await this.analyticsRepository.dismissAnomaly(orgId, id);
    // updateMany over (id, orgId) — 0 rows means the anomaly isn't this org's.
    if (res.count === 0) {
      throw new NotFoundException('Anomaly not found');
    }
    return { success: true };
  }

  // ── 7.3: user-defined alert rules — thin org-scoped pass-throughs ──

  listAlertRules(orgId: string) {
    return this.analyticsRepository.listAlertRules(orgId);
  }

  // Reject a provided integrationId that isn't one of the org's live channels
  // (a typo'd id would otherwise persist a rule that silently never fires).
  private async assertIntegrationInOrg(orgId: string, integrationId?: string) {
    if (!integrationId) return;
    const found = await this.analyticsRepository.getIntegrations(orgId, [
      integrationId,
    ]);
    if (!found.length) {
      throw new BadRequestException('integrationId is not a channel of this organization');
    }
  }

  async createAlertRule(
    orgId: string,
    data: {
      integrationId?: string;
      metric: string;
      comparator: string;
      threshold: number;
      direction?: string;
      enabled?: boolean;
    },
  ) {
    await this.assertIntegrationInOrg(orgId, data.integrationId);
    return this.analyticsRepository.createAlertRule({
      organizationId: orgId,
      integrationId: data.integrationId ?? null,
      metric: data.metric,
      comparator: data.comparator,
      threshold: data.threshold,
      direction: data.direction,
      enabled: data.enabled,
    });
  }

  async updateAlertRule(
    orgId: string,
    id: string,
    data: {
      integrationId?: string;
      metric?: string;
      comparator?: string;
      threshold?: number;
      direction?: string;
      enabled?: boolean;
    },
  ) {
    await this.assertIntegrationInOrg(orgId, data.integrationId);
    const res = await this.analyticsRepository.updateAlertRule(orgId, id, data);
    // updateMany over (id, orgId) — 0 rows means the rule isn't this org's.
    if (res.count === 0) {
      throw new NotFoundException('Alert rule not found');
    }
    return this.analyticsRepository.getAlertRule(orgId, id);
  }

  async deleteAlertRule(orgId: string, id: string): Promise<{ success: boolean }> {
    const res = await this.analyticsRepository.deleteAlertRule(orgId, id);
    return { success: res.count > 0 };
  }
}
