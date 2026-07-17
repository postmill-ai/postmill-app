// Metric / day / channel drill-down reads extracted from analytics.service.ts
// (5.3). Behaviour-neutral: identical logic, injected with the repo +
// live-fallback it needs, using the pure aggregation helpers (no DI cycle).
// The facade delegates getMetricDetail/getDayDetail/getChannelMetric here.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { isKnownMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  AnalyticsMetricDetailResponse,
  MetricSeries,
  SnapshotLike,
} from './analytics.types';
import {
  aggregatePostSnapshotTotal,
  aggregateSnapshots,
  buildFilledDayMap,
  buildPostSnapshotSeries,
  computePercentageChange,
  getMetricDef,
  PostSnapshotLike,
  tagSeriesGranularity,
} from './analytics-aggregation';
import { AnalyticsLiveFallbackService } from './analytics-live-fallback';

dayjs.extend(utc);

@Injectable()
export class AnalyticsDetailService {
  private readonly _logger = new Logger(AnalyticsDetailService.name);

  constructor(
    private analyticsRepository: AnalyticsRepository,
    private liveFallback: AnalyticsLiveFallbackService,
  ) {}

  private async getSnapshots(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    return this.analyticsRepository.getSnapshots(orgId, integrationIds, from, to);
  }

  private async getIntegrations(orgId: string, integrationIds: string[]) {
    return this.analyticsRepository.getIntegrations(orgId, integrationIds);
  }

  // R1.5: per-post baseline (level just before `before`) for ONE metric under
  // campaign scope — Map<postId, value>. Missing (post, metric) ⇒ absent ⇒ the
  // level helpers treat it as baseline 0.
  private async postBaselines(
    orgId: string,
    campaignIds: string[],
    before: Date,
    integrationIds: string[] | undefined,
    metric: string
  ): Promise<Map<string, number>> {
    const rows =
      await this.analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns(
        orgId,
        campaignIds,
        before,
        integrationIds
      );
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.metric === metric) map.set(r.postId, r.value);
    }
    return map;
  }

  async getMetricDetail(
    org: Organization,
    metric: string,
    from: string,
    to: string,
    integrationIds: string[],
    compare: boolean,
    opts: { campaignIds?: string[] } = {}
  ): Promise<AnalyticsMetricDetailResponse> {
    if (!isKnownMetric(metric)) {
      throw new NotFoundException(`Unknown metric: ${metric}`);
    }

    const campaignIds = opts.campaignIds ?? [];
    const scoped = campaignIds.length > 0;
    const def = getMetricDef(metric);
    const fromDate = dayjs(from).startOf('day').toDate();
    const toDate = dayjs(to).endOf('day').toDate();
    let dbIntegrations = await this.getIntegrations(org.id, integrationIds);
    let ids = dbIntegrations.map((i) => i.id);
    // R1.6: the explicit channel filter captured BEFORE `ids` is reassigned to
    // the campaign's derived channel set, so the previous window is filtered by
    // the same explicit filter (or none) the current window used — matching
    // computeCampaignOverview, which passes the original filterIds both windows.
    const explicitFilter = ids.length ? [...ids] : undefined;

    // R1.5: per-post baselines (level just before each window) for level-
    // semantics differencing under campaign scope. Single metric here, so a
    // plain Map<postId, value>.
    let baselines = new Map<string, number>();
    let prevBaselines = new Map<string, number>();

    // Level-aware aggregation strategy: campaign scope differences post-snapshot
    // levels against a baseline; the channel path is byte-identical.
    const sumOf = (rows: SnapshotLike[], base: Map<string, number>) =>
      scoped
        ? aggregatePostSnapshotTotal(
            rows as unknown as PostSnapshotLike[],
            base,
            metric
          )
        : aggregateSnapshots(rows, metric);
    const dayMapOf = (
      rows: SnapshotLike[],
      f: Date,
      t: Date,
      offset: number,
      base: Map<string, number>
    ) =>
      scoped
        ? buildPostSnapshotSeries(
            rows as unknown as PostSnapshotLike[],
            base,
            metric,
            f,
            t,
            offset
          )
        : buildFilledDayMap(rows, metric, f, t, def.kind, offset);

    let snapshots: SnapshotLike[];
    if (scoped) {
      // Campaign scope (1.3): post snapshots via Post.campaignId, no live
      // fallback. When no explicit channel filter is passed, derive the channel
      // set from the campaign's own snapshots.
      snapshots = await this.analyticsRepository.getPostSnapshotsByCampaigns(
        org.id, campaignIds, fromDate, toDate, explicitFilter
      );
      baselines = await this.postBaselines(
        org.id, campaignIds, fromDate, explicitFilter, metric
      );
      if (!ids.length) {
        const derived = [...new Set(snapshots.map((s) => s.integrationId))];
        dbIntegrations = derived.length ? await this.getIntegrations(org.id, derived) : [];
        ids = dbIntegrations.map((i) => i.id);
      }
    } else {
      snapshots = await this.getSnapshots(org.id, ids, fromDate, toDate);
      snapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
        org, ids, dbIntegrations, fromDate, toDate, snapshots
      );
    }

    const windowSize = dayjs(toDate).diff(dayjs(fromDate), 'day');
    let previousSnapshots: any[] = [];
    if (compare) {
      const prevToDate = dayjs(fromDate)
        .subtract(1, 'day')
        .endOf('day')
        .toDate();
      const prevFromDate = dayjs(prevToDate)
        .subtract(windowSize, 'day')
        .startOf('day')
        .toDate();

      if (scoped) {
        // R1.6: previous window uses explicitFilter (not the derived channel
        // set), matching the current window and computeCampaignOverview.
        previousSnapshots = (
          await this.analyticsRepository.getPostSnapshotsByCampaigns(
            org.id, campaignIds, prevFromDate, prevToDate, explicitFilter
          )
        ).filter((s) => s.metric === metric);
        prevBaselines = await this.postBaselines(
          org.id, campaignIds, prevFromDate, explicitFilter, metric
        );
      } else {
        previousSnapshots = (
          await this.getSnapshots(org.id, ids, prevFromDate, prevToDate)
        ).filter((s) => s.metric === metric);

        previousSnapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
          org, ids, dbIntegrations, prevFromDate, prevToDate, previousSnapshots, metric
        );
      }
    }

    const metricSnapshots = snapshots.filter((s) => s.metric === metric);

    const total = sumOf(snapshots, baselines);
    const previousTotal = compare
      ? sumOf(previousSnapshots, prevBaselines)
      : null;
    const percentageChange = computePercentageChange(
      total,
      previousTotal,
      def.format
    );

    const currentMap = dayMapOf(snapshots, fromDate, toDate, 0, baselines);

    let prevOffsetMap: Record<string, number> = {};
    if (compare) {
      const prevToDate = dayjs(fromDate)
        .subtract(1, 'day')
        .endOf('day')
        .toDate();
      const prevFromDate = dayjs(prevToDate)
        .subtract(windowSize, 'day')
        .startOf('day')
        .toDate();
      const dateOffset = windowSize + 1;
      prevOffsetMap = dayMapOf(
        previousSnapshots,
        prevFromDate,
        prevToDate,
        dateOffset,
        prevBaselines
      );
    }

    const series: MetricSeries[] = [];
    let cursor = dayjs(fromDate);
    const end = dayjs(toDate);
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const key = cursor.format('YYYY-MM-DD');
      series.push({
        date: key,
        value: currentMap[key] || 0,
        ...(compare ? { previousValue: prevOffsetMap[key] || 0 } : {}),
      });
      cursor = cursor.add(1, 'day');
    }

    // 6.1 — under campaign scope this series can span past the post-snapshot
    // retention window (weekly rollup rows beyond it); label each point's
    // granularity so charts render the daily/weekly seam.
    if (scoped) {
      tagSeriesGranularity(series);
    }

    const channelTotals: Record<string, number> = {};
    for (const int of dbIntegrations) {
      channelTotals[int.id] = sumOf(
        metricSnapshots.filter((s) => s.integrationId === int.id),
        baselines
      );
    }

    const totalValue =
      Object.values(channelTotals).reduce((a, b) => a + b, 0) || 1;

    const byChannel = dbIntegrations.map((int) => {
      const channelTotal = channelTotals[int.id] || 0;
      const channelPrevSnapshots = compare
        ? previousSnapshots.filter((s) => s.integrationId === int.id)
        : [];
      const channelPrevious = compare
        ? sumOf(channelPrevSnapshots, prevBaselines)
        : null;
      return {
        integrationId: int.id,
        name: int.name,
        identifier: int.providerIdentifier,
        picture: int.picture,
        value: channelTotal,
        percentageChange: computePercentageChange(
          channelTotal,
          channelPrevious,
          def.format
        ),
        share: Math.round((channelTotal / totalValue) * 10000) / 100,
      };
    });

    let topPosts: any[] = [];
    try {
      // Secondary, best-effort list. Under campaign scope this is keyed by the
      // campaign's derived channels, so a channel shared across campaigns can
      // surface a sibling campaign's post here — the primary aggregates above
      // stay campaign-exact. (Phase-1 approximation; refined in a later phase.)
      const topPostsSnapshots =
        await this.analyticsRepository.getMetricDetailTopPosts(org.id, ids, metric, fromDate, toDate);
      // Rows are value-desc LEVELS; dedup to one entry per post (its highest
      // row = latest level) so one daily-snapshotted post can't fill the list.
      const seenPosts = new Set<string>();
      topPosts = topPostsSnapshots
        .filter((snap) => {
          if (seenPosts.has(snap.postId)) return false;
          seenPosts.add(snap.postId);
          return true;
        })
        .slice(0, 10)
        .map((snap) => ({
        postId: snap.postId,
        content: (snap.post as any)?.content?.substring(0, 200) || '',
        publishedAt: (snap.post as any)?.publishDate?.toISOString() || '',
        value: snap.value,
        integrationId: snap.integrationId,
      }));
    } catch (err) {
      this._logger.error(`getMetricDetail top-posts fallback: ${(err as Error)?.message}`);
    }

    const movers: { up: any[]; down: any[] } = { up: [], down: [] };
    if (compare) {
      const changes = dbIntegrations.map((int) => {
        const currentVal = sumOf(
          metricSnapshots.filter((s) => s.integrationId === int.id),
          baselines
        );
        const prevVal = sumOf(
          previousSnapshots.filter((s) => s.integrationId === int.id),
          prevBaselines
        );
        const pctChange = computePercentageChange(
          currentVal,
          prevVal,
          def.format
        );
        return {
          integrationId: int.id,
          name: int.name,
          identifier: int.providerIdentifier,
          picture: int.picture,
          value: currentVal,
          previousValue: prevVal,
          percentageChange: pctChange,
        };
      });

      changes.sort(
        (a, b) => (b.percentageChange || 0) - (a.percentageChange || 0)
      );
      movers.up = changes
        .filter((c) => (c.percentageChange || 0) > 0)
        .slice(0, 3);
      movers.down = changes
        .filter((c) => (c.percentageChange || 0) < 0)
        .reverse()
        .slice(0, 3);
    }

    return {
      metric,
      label: def.label,
      format: def.format,
      total,
      previousTotal,
      percentageChange,
      series,
      byChannel,
      topPosts,
      movers,
    };
  }

  async getDayDetail(
    org: Organization,
    date: string,
    metric: string,
    integrationIds: string[],
    opts: { campaignIds?: string[] } = {}
  ) {
    if (!isKnownMetric(metric)) {
      throw new NotFoundException(`Unknown metric: ${metric}`);
    }

    const campaignIds = opts.campaignIds ?? [];
    const scoped = campaignIds.length > 0;
    const dateStart = dayjs(date).startOf('day').toDate();
    const dateEnd = dayjs(date).endOf('day').toDate();
    let dbIntegrations = await this.getIntegrations(org.id, integrationIds);
    let ids = dbIntegrations.map((i) => i.id);

    const explicitFilter = ids.length ? [...ids] : undefined;
    const def = getMetricDef(metric);

    // `valueRows` feeds day total + byChannel. Unscoped = channel
    // AnalyticsSnapshot (true dailies — summed as-is); campaign scope = post
    // snapshots via Post.campaignId (LEVELS — R1.5-differenced against the level
    // just before this day so the drilled day-value is a delta, not the running
    // total). Channel metrics are not campaign-attributable, so they're excluded.
    let valueRows: { integrationId: string; postId?: string; value: number }[];
    let postSnapshots: Awaited<
      ReturnType<AnalyticsRepository['getDayPostSnapshots']>
    >;
    let dayBaselines = new Map<string, number>();
    if (scoped) {
      const campaignRows = (
        await this.analyticsRepository.getPostSnapshotsByCampaigns(
          org.id, campaignIds, dateStart, dateEnd, explicitFilter
        )
      ).filter((s) => s.metric === metric);
      dayBaselines = await this.postBaselines(
        org.id, campaignIds, dateStart, explicitFilter, metric
      );
      if (!ids.length) {
        const derived = [...new Set(campaignRows.map((s) => s.integrationId))];
        dbIntegrations = derived.length ? await this.getIntegrations(org.id, derived) : [];
        ids = dbIntegrations.map((i) => i.id);
      }
      valueRows = campaignRows;
      // Secondary post list keeps content via the day post read on the
      // campaign's derived channels (best-effort — same shared-channel caveat
      // as the metric-detail top posts).
      postSnapshots = ids.length
        ? await this.analyticsRepository.getDayPostSnapshots(org.id, ids, metric, dateStart, dateEnd)
        : [];
    } else {
      const [snapshots, ps] = await Promise.all([
        this.analyticsRepository.getDayAnalyticsSnapshots(org.id, ids, metric, dateStart, dateEnd),
        this.analyticsRepository.getDayPostSnapshots(org.id, ids, metric, dateStart, dateEnd),
      ]);
      valueRows = snapshots;
      postSnapshots = ps;
    }

    let totalValue: number;
    const channelTotals: Record<string, number> = {};
    if (scoped && def.format !== 'percent') {
      // Level differencing: this day's contribution = max(0, level − baseline).
      totalValue = 0;
      for (const row of valueRows) {
        const c = Math.max(0, row.value - (dayBaselines.get(row.postId!) ?? 0));
        totalValue += c;
        channelTotals[row.integrationId] =
          (channelTotals[row.integrationId] || 0) + c;
      }
    } else if (scoped) {
      // Percent metric: average the day's levels, never sum/difference.
      totalValue = valueRows.length
        ? valueRows.reduce((a, b) => a + b.value, 0) / valueRows.length
        : 0;
      const perInt: Record<string, number[]> = {};
      for (const row of valueRows) {
        (perInt[row.integrationId] ||= []).push(row.value);
      }
      for (const [intId, vals] of Object.entries(perInt)) {
        channelTotals[intId] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    } else {
      totalValue = valueRows.reduce((a, b) => a + b.value, 0);
      for (const snap of valueRows) {
        channelTotals[snap.integrationId] =
          (channelTotals[snap.integrationId] || 0) + snap.value;
      }
    }

    const byChannel = dbIntegrations.map((int) => ({
      integrationId: int.id,
      name: int.name,
      identifier: int.providerIdentifier,
      picture: int.picture,
      value: channelTotals[int.id] || 0,
    }));

    const posts = postSnapshots.map((snap) => {
      const int = dbIntegrations.find((i) => i.id === snap.integrationId);
      return {
        postId: snap.postId,
        content: (snap.post as any)?.content?.substring(0, 200) || '',
        integration: int
          ? {
              id: int.id,
              name: int.name,
              identifier: int.providerIdentifier,
              picture: int.picture,
            }
          : null,
        value: snap.value,
        publishedAt: (snap.post as any)?.publishDate?.toISOString() || '',
        metrics: { [metric]: snap.value },
      };
    });

    return {
      date,
      metric,
      value: totalValue,
      byChannel,
      posts,
    };
  }

  async getChannelMetric(
    org: Organization,
    integrationId: string,
    metric: string,
    from: string,
    to: string,
    compare: boolean
  ) {
    if (!isKnownMetric(metric)) {
      throw new NotFoundException(`Unknown metric: ${metric}`);
    }

    const def = getMetricDef(metric);
    const fromDate = dayjs(from).startOf('day').toDate();
    const toDate = dayjs(to).endOf('day').toDate();
    const dbIntegrations = await this.getIntegrations(org.id, [integrationId]);
    if (dbIntegrations.length === 0) {
      throw new NotFoundException('Integration not found');
    }

    let snapshots: SnapshotLike[] = await this.analyticsRepository.getChannelAnalyticsSnapshots(org.id, integrationId, metric, fromDate, toDate);

    snapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
      org, [integrationId], dbIntegrations, fromDate, toDate, snapshots, metric
    );

    const windowSize = dayjs(toDate).diff(dayjs(fromDate), 'day');
    const dateOffset = windowSize + 1;
    let previousSnapshots: any[] = [];
    if (compare) {
      const prevToDate = dayjs(fromDate)
        .subtract(1, 'day')
        .endOf('day')
        .toDate();
      const prevFromDate = dayjs(prevToDate)
        .subtract(windowSize, 'day')
        .startOf('day')
        .toDate();

      previousSnapshots = await this.analyticsRepository.getChannelAnalyticsSnapshots(org.id, integrationId, metric, prevFromDate, prevToDate);

      previousSnapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
        org, [integrationId], dbIntegrations, prevFromDate, prevToDate, previousSnapshots, metric
      );
    }

    const dailyMap = buildFilledDayMap(
      snapshots,
      metric,
      fromDate,
      toDate,
      def.kind,
      0
    );

    let prevDailyMap: Record<string, number> = {};
    if (compare) {
      const prevToDate = dayjs(fromDate)
        .subtract(1, 'day')
        .endOf('day')
        .toDate();
      const prevFromDate = dayjs(prevToDate)
        .subtract(windowSize, 'day')
        .startOf('day')
        .toDate();
      prevDailyMap = buildFilledDayMap(
        previousSnapshots,
        metric,
        prevFromDate,
        prevToDate,
        def.kind,
        dateOffset
      );
    }

    const series: MetricSeries[] = [];
    let cursor = dayjs(fromDate);
    const end = dayjs(toDate);
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      const key = cursor.format('YYYY-MM-DD');
      series.push({
        date: key,
        value: dailyMap[key] || 0,
        ...(compare ? { previousValue: prevDailyMap[key] || 0 } : {}),
      });
      cursor = cursor.add(1, 'day');
    }

    const postSnapshots = await this.analyticsRepository.getChannelPostSnapshots(org.id, integrationId, metric, fromDate, toDate);

    // Same per-post dedup as getMetricDetail: rows are value-desc levels.
    const seenTopPosts = new Set<string>();
    const topPosts = postSnapshots
      .filter((snap) => {
        if (seenTopPosts.has(snap.postId)) return false;
        seenTopPosts.add(snap.postId);
        return true;
      })
      .slice(0, 10)
      .map((snap) => ({
      postId: snap.postId,
      content: (snap.post as any)?.content?.substring(0, 200) || '',
      publishedAt: (snap.post as any)?.publishDate?.toISOString() || '',
      value: snap.value,
    }));

    const dayTotals: Record<string, number> = {};
    for (const row of snapshots) {
      const key = dayjs(row.date).format('YYYY-MM-DD');
      dayTotals[key] = (dayTotals[key] || 0) + row.value;
    }
    const byDay = Object.entries(dayTotals).map(([date, value]) => ({
      date,
      value,
    }));

    return { series, topPosts, byDay };
  }
}
