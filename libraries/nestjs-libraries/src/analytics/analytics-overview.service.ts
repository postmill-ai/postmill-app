// Overview / channel / posts / post-detail compute extracted from
// analytics.service.ts (5.3). Behaviour-neutral: identical logic, now injected
// with the repo + live-fallback + posts + redis it needs. Uses the pure
// aggregation helpers so there is no DI cycle. The facade delegates its
// getOverview/getChannel/getPosts/getPostDetail to this service unchanged.

import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { singleFlight } from '@gitroom/nestjs-libraries/utils/concurrency';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { isKnownMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { createHash } from 'crypto';
import { RedisService } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  AnalyticsOverviewResponse,
  ByChannelItem,
  DataHealthItem,
  KpiItem,
  MetricSeries,
  SnapshotLike,
} from './analytics.types';
import {
  aggregatePostSnapshotTotal,
  aggregateSnapshots,
  buildPostSnapshotSeries,
  buildPrevMap,
  buildSeries,
  buildSparkline,
  computeDerivedMetrics,
  computePercentageChange,
  getMetricDef,
  PostSnapshotLike,
  tagSeriesGranularity,
} from './analytics-aggregation';
import { AnalyticsLiveFallbackService } from './analytics-live-fallback';

dayjs.extend(utc);

// Window (days) for a data-health snapshot-coverage read (6.6).
const HEALTH_WINDOW_DAYS = 7;
// Window (days) an on-demand refresh pulls + persists (6.7).
const REFRESH_WINDOW_DAYS = 30;

@Injectable()
export class AnalyticsOverviewService {
  private readonly _logger = new Logger(AnalyticsOverviewService.name);

  constructor(
    private analyticsRepository: AnalyticsRepository,
    private liveFallback: AnalyticsLiveFallbackService,
    private postsService: PostsService,
    private _redisService: RedisService,
    private integrationService: IntegrationService,
  ) {}

  private async getSnapshots(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    return this.analyticsRepository.getSnapshots(orgId, integrationIds, from, to);
  }

  private async getPostSnapshots(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    return this.analyticsRepository.getPostSnapshots(orgId, integrationIds, from, to);
  }

  private async getIntegrations(orgId: string, integrationIds: string[]) {
    return this.analyticsRepository.getIntegrations(orgId, integrationIds);
  }

  async getOverview(
    org: Organization,
    from: string,
    to: string,
    integrations: string[],
    compare: boolean,
    opts: { campaignIds?: string[] } = {}
  ): Promise<AnalyticsOverviewResponse> {
    const campaignIds = opts.campaignIds ?? [];
    // G4: hot-path span. `trace.getTracer` returns a no-op tracer when no OTel SDK
    // is started, so the whole wrapper is zero-cost and behaviour-neutral on the
    // production default (spans/attributes are dropped).
    const tracer = trace.getTracer('postmill');
    return tracer.startActiveSpan('analytics.getOverview', async (span) => {
      span.setAttribute('orgId', org.id);
      try {
        const fromDate = dayjs(from).startOf('day').toDate();
        const toDate = dayjs(to).endOf('day').toDate();

        // 60s Redis cache. Today-ending windows (the dashboard default) are cached
        // too: snapshots only change via the daily sweep, and recomputing the
        // overview — including its potential live provider fan-out — on every view
        // is the dashboard's dominant CPU/memory cost. getChannel/getPosts/
        // recommendations all funnel through here, so one uncached view recomputed
        // everything several times over.
        // `campaignIds` MUST be in the hashed object — campaign-scoped results are
        // a different dataset (post metrics only) and would otherwise collide with
        // the unscoped overview in the 60s cache.
        const cacheKey = `analytics:overview:${org.id}:${createHash('sha256').update(JSON.stringify({ from, to, integrations, compare, campaignIds })).digest('hex')}`;
        try {
          const cached = await this._redisService.get(cacheKey);
          if (cached) {
            span.setAttribute('cacheHit', true);
            span.setAttribute('liveFallback', false);
            return JSON.parse(cached) as AnalyticsOverviewResponse;
          }
        } catch { /* cache miss — continue */ }
        span.setAttribute('cacheHit', false);

        // G5: single-flight the cache-miss compute. Concurrent same-key misses await
        // ONE computation keyed by the Redis cache key, then the entry is dropped.
        // Per-instance only (in-process Map in `singleFlight`) — NOT cross-replica;
        // Redis remains the cross-replica cache layer. `liveFallback` reflects the
        // originating compute only (piggyback callers report false — telemetry-only).
        let liveFallback = false;
        const overview = await singleFlight<AnalyticsOverviewResponse>(
          cacheKey,
          async () => {
            let result: AnalyticsOverviewResponse;

            if (campaignIds.length > 0) {
              // Campaign scope (1.3): metrics derive ONLY from post snapshots
              // joined through Post.campaignId; live fallback is skipped (a
              // campaign-wide provider fan-out would be a provider hammer, and
              // post snapshots keep their own per-post fallback in getPostDetail).
              result = await this.computeCampaignOverview(
                org, from, to, fromDate, toDate, integrations, campaignIds, compare
              );
            } else {
              const dbIntegrations = await this.getIntegrations(org.id, integrations);

              if (dbIntegrations.length === 0) {
                return {
                  range: { from, to },
                  kpis: [],
                  series: {},
                  byChannel: [],
                  breakdown: { byPlatform: [] },
                  derived: { engagementRate: null, reachPerFollower: null },
                };
              }

              const integrationIds = dbIntegrations.map((i) => i.id);

              let snapshots: SnapshotLike[] = await this.getSnapshots(
                org.id,
                integrationIds,
                fromDate,
                toDate
              );

              const snapshotsBefore = snapshots;
              snapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
                org, integrationIds, dbIntegrations, fromDate, toDate, snapshots
              );
              if (snapshots !== snapshotsBefore) liveFallback = true;

              let previousSnapshots: SnapshotLike[] = [];
              if (compare) {
                const windowSize = dayjs(toDate).diff(dayjs(fromDate), 'day');
                const prevToDate = dayjs(fromDate)
                  .subtract(1, 'day')
                  .endOf('day')
                  .toDate();
                const prevFromDate = dayjs(prevToDate)
                  .subtract(windowSize, 'day')
                  .startOf('day')
                  .toDate();

                previousSnapshots = await this.getSnapshots(
                  org.id,
                  integrationIds,
                  prevFromDate,
                  prevToDate
                );

                const previousBefore = previousSnapshots;
                previousSnapshots = await this.liveFallback.applyLiveFallbackIfNeeded(
                  org, integrationIds, dbIntegrations, prevFromDate, prevToDate, previousSnapshots
                );
                if (previousSnapshots !== previousBefore) liveFallback = true;
              }

              result = this.assembleOverview(
                from, to, fromDate, toDate, dbIntegrations, snapshots, previousSnapshots, compare
              );
            }

            this._redisService.set(cacheKey, JSON.stringify(result), 60).catch(() => {});

            return result;
          }
        );

        span.setAttribute('liveFallback', liveFallback);
        return overview;
      } finally {
        span.end();
      }
    });
  }

  // Behaviour-neutral extraction of the overview kpi/byChannel/breakdown/series
  // assembly (shared by the unscoped and campaign-scoped paths). Takes already
  // resolved snapshots + previousSnapshots so the caller owns the source
  // (channel snapshots + live fallback, vs. campaign post snapshots).
  private assembleOverview(
    from: string,
    to: string,
    fromDate: Date,
    toDate: Date,
    dbIntegrations: {
      id: string;
      name: string;
      providerIdentifier: string;
      picture: string | null;
    }[],
    snapshots: SnapshotLike[],
    previousSnapshots: SnapshotLike[],
    compare: boolean,
    scope?: 'campaign-posts',
    baselines?: Map<string, Map<string, number>>,
    prevBaselines?: Map<string, Map<string, number>>
  ): AnalyticsOverviewResponse {
    // R1.4: under campaign scope the rows are PostAnalyticsSnapshot LEVELS, so
    // totals difference against a per-post baseline (level just before the
    // window) and series are per-day deltas of those levels. The channel path is
    // left calling the exact same functions as before (byte-identical) — every
    // branch is gated on `useLevel`.
    const useLevel = scope === 'campaign-posts';
    const EMPTY_BASE = new Map<string, number>();
    const curBaselines = baselines ?? new Map<string, Map<string, number>>();
    const prevBase = prevBaselines ?? new Map<string, Map<string, number>>();
    const asPost = (rows: SnapshotLike[]) =>
      rows as unknown as PostSnapshotLike[];

    const totalOf = (
      rows: SnapshotLike[],
      metric: string,
      base: Map<string, Map<string, number>>
    ) =>
      useLevel
        ? aggregatePostSnapshotTotal(
            asPost(rows),
            base.get(metric) ?? EMPTY_BASE,
            metric
          )
        : aggregateSnapshots(rows, metric);
    // Level-aware derived ratios: under campaign scope the flow-sum inside
    // computeDerivedMetrics would inflate numerator and denominator by each
    // metric's snapshot-day count (which skews the ratio when coverage differs
    // per metric). Compute from the same level-differenced totals the KPIs use;
    // followers is a channel-level metric absent under campaign scope, so
    // reachPerFollower is null there.
    const derivedOf = (rows: SnapshotLike[]) => {
      if (!useLevel) return computeDerivedMetrics(rows);
      const impressions = totalOf(rows, 'impressions', curBaselines);
      const likes = totalOf(rows, 'likes', curBaselines);
      const comments = totalOf(rows, 'comments', curBaselines);
      const shares = totalOf(rows, 'shares', curBaselines);
      return {
        engagementRate:
          impressions > 0 ? (likes + comments + shares) / impressions : null,
        reachPerFollower: null,
      };
    };

    const sparkOf = (rows: SnapshotLike[], metric: string) => {
      if (!useLevel) return buildSparkline(rows, metric, fromDate, toDate);
      const dayMap = buildPostSnapshotSeries(
        asPost(rows),
        curBaselines.get(metric) ?? EMPTY_BASE,
        metric,
        fromDate,
        toDate,
        0
      );
      return Object.entries(dayMap).map(([date, value]) => ({ date, value }));
    };

    const metrics = [...new Set(snapshots.map((s) => s.metric))].filter(
      isKnownMetric
    );

    const windowSize = dayjs(toDate).diff(dayjs(fromDate), 'day');

    const kpis: KpiItem[] = metrics.map((metric) => {
      const def = getMetricDef(metric);
      const total = totalOf(snapshots, metric, curBaselines);
      const previousTotal = compare
        ? totalOf(previousSnapshots, metric, prevBase)
        : null;
      const percentageChange = computePercentageChange(
        total,
        previousTotal,
        def.format
      );

      return {
        metric,
        label: def.label,
        format: def.format,
        total,
        previousTotal,
        percentageChange,
        sparkline: sparkOf(snapshots, metric),
      };
    });

    const byChannel: ByChannelItem[] = dbIntegrations.map((int) => {
      const channelSnapshots = snapshots.filter(
        (s) => s.integrationId === int.id
      );
      const channelKpis = metrics.map((metric) => {
        const def = getMetricDef(metric);
        const total = totalOf(channelSnapshots, metric, curBaselines);
        const previousTotal = compare
          ? totalOf(
              previousSnapshots.filter((s) => s.integrationId === int.id),
              metric,
              prevBase
            )
          : null;
        const percentageChange = computePercentageChange(
          total,
          previousTotal,
          def.format
        );
        return {
          metric,
          label: def.label,
          format: def.format,
          total,
          previousTotal,
          percentageChange,
        };
      });

      return {
        integrationId: int.id,
        name: int.name,
        identifier: int.providerIdentifier,
        picture: int.picture,
        kpis: channelKpis,
        // 6.2 — per-channel engagement rate / reach-per-follower so a small
        // channel can be compared fairly against a large one.
        derived: derivedOf(channelSnapshots),
      };
    });

    const primaryMetric = metrics[0] || 'impressions';
    const platformBreakup: Record<string, number> = {};
    for (const int of dbIntegrations) {
      const intSnapshots = snapshots.filter((s) => s.integrationId === int.id);
      const total = totalOf(intSnapshots, primaryMetric, curBaselines);
      if (total > 0) {
        platformBreakup[int.providerIdentifier] =
          (platformBreakup[int.providerIdentifier] || 0) + total;
      }
    }

    const result: AnalyticsOverviewResponse = {
      range: { from, to },
      kpis,
      series: (() => {
        // Level-aware series builders under campaign scope; the channel path
        // keeps calling buildSeries/buildPrevMap unchanged (byte-identical).
        const buildCampaignSeries = (): Record<string, MetricSeries[]> => {
          const out: Record<string, MetricSeries[]> = {};
          for (const m of [
            ...new Set(snapshots.map((sn) => sn.metric)),
          ].filter(isKnownMetric)) {
            const dayMap = buildPostSnapshotSeries(
              asPost(snapshots),
              curBaselines.get(m) ?? EMPTY_BASE,
              m,
              fromDate,
              toDate,
              0
            );
            out[m] = Object.entries(dayMap).map(([date, value]) => ({
              date,
              value,
            }));
          }
          return out;
        };
        const buildCampaignPrevMap = (
          prevFrom: Date,
          prevTo: Date,
          offset: number
        ): Record<string, Record<string, number>> => {
          const out: Record<string, Record<string, number>> = {};
          for (const m of [
            ...new Set(previousSnapshots.map((sn) => sn.metric)),
          ].filter(isKnownMetric)) {
            out[m] = buildPostSnapshotSeries(
              asPost(previousSnapshots),
              prevBase.get(m) ?? EMPTY_BASE,
              m,
              prevFrom,
              prevTo,
              offset
            );
          }
          return out;
        };

        const s = useLevel
          ? buildCampaignSeries()
          : buildSeries(snapshots, fromDate, toDate);
        if (compare && previousSnapshots.length > 0) {
          const prevToDate = dayjs(fromDate)
            .subtract(1, 'day')
            .endOf('day')
            .toDate();
          const prevFromDate = dayjs(prevToDate)
            .subtract(windowSize, 'day')
            .startOf('day')
            .toDate();
          const dateOffset = windowSize + 1;
          const prevMap = useLevel
            ? buildCampaignPrevMap(prevFromDate, prevToDate, dateOffset)
            : buildPrevMap(
                previousSnapshots,
                prevFromDate,
                prevToDate,
                dateOffset
              );
          for (const [metric, points] of Object.entries(s)) {
            const prevMetric = prevMap[metric];
            if (!prevMetric) continue;
            for (const point of points) {
              point.previousValue = prevMetric[point.date] || 0;
            }
          }
        }
        // 6.1 — the campaign series can span past the post-snapshot retention
        // window (weekly rollup rows beyond it); label each point's granularity
        // so charts render the daily/weekly seam. Unscoped org overview stays
        // unlabeled.
        if (scope === 'campaign-posts') {
          for (const points of Object.values(s)) {
            tagSeriesGranularity(points);
          }
        }
        return s;
      })(),
      byChannel,
      breakdown: {
        byPlatform: Object.entries(platformBreakup).map(
          ([identifier, value]) => ({
            identifier,
            value,
          })
        ),
      },
      // 6.2 — org-wide derived ratios over all channels' snapshots.
      derived: derivedOf(snapshots),
      ...(scope ? { scope } : {}),
    };

    return result;
  }

  // Campaign-scoped overview (1.3): sources rows from PostAnalyticsSnapshot via
  // Post.campaignId (no channel AnalyticsSnapshot merge, no live fallback). The
  // channel set for byChannel/breakdown is derived from the campaign's own post
  // snapshots when no explicit integration filter is passed.
  private async computeCampaignOverview(
    org: Organization,
    from: string,
    to: string,
    fromDate: Date,
    toDate: Date,
    integrations: string[],
    campaignIds: string[],
    compare: boolean
  ): Promise<AnalyticsOverviewResponse> {
    const filterIds = integrations.length > 0 ? integrations : undefined;

    const snapshots: SnapshotLike[] =
      await this.analyticsRepository.getPostSnapshotsByCampaigns(
        org.id,
        campaignIds,
        fromDate,
        toDate,
        filterIds
      );

    // R1.4: per-post baseline = level just before the window, so KPI totals are
    // true window deltas rather than the cumulative running total.
    const baselines = await this.getCampaignBaselines(
      org.id,
      campaignIds,
      fromDate,
      filterIds
    );

    const derivedIds = filterIds ?? [
      ...new Set(snapshots.map((s) => s.integrationId)),
    ];
    const dbIntegrations = derivedIds.length
      ? await this.getIntegrations(org.id, derivedIds)
      : [];

    let previousSnapshots: SnapshotLike[] = [];
    let prevBaselines = new Map<string, Map<string, number>>();
    if (compare) {
      const windowSize = dayjs(toDate).diff(dayjs(fromDate), 'day');
      const prevToDate = dayjs(fromDate)
        .subtract(1, 'day')
        .endOf('day')
        .toDate();
      const prevFromDate = dayjs(prevToDate)
        .subtract(windowSize, 'day')
        .startOf('day')
        .toDate();
      previousSnapshots =
        await this.analyticsRepository.getPostSnapshotsByCampaigns(
          org.id,
          campaignIds,
          prevFromDate,
          prevToDate,
          filterIds
        );
      prevBaselines = await this.getCampaignBaselines(
        org.id,
        campaignIds,
        prevFromDate,
        filterIds
      );
    }

    return this.assembleOverview(
      from,
      to,
      fromDate,
      toDate,
      dbIntegrations,
      snapshots,
      previousSnapshots,
      compare,
      'campaign-posts',
      baselines,
      prevBaselines
    );
  }

  // R1.4/R1.5 shared baseline reader. Returns metric → (postId → level just
  // before `before`). The pure helpers take a per-metric `Map<postId, number>`,
  // so callers select `baselines.get(metric)` for the metric being aggregated —
  // a post's baseline is correctly metric-specific.
  private async getCampaignBaselines(
    orgId: string,
    campaignIds: string[],
    before: Date,
    integrationIds?: string[]
  ): Promise<Map<string, Map<string, number>>> {
    const rows =
      await this.analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns(
        orgId,
        campaignIds,
        before,
        integrationIds
      );
    const byMetric = new Map<string, Map<string, number>>();
    for (const r of rows) {
      let m = byMetric.get(r.metric);
      if (!m) {
        m = new Map<string, number>();
        byMetric.set(r.metric, m);
      }
      m.set(r.postId, r.value);
    }
    return byMetric;
  }

  async getChannel(
    org: Organization,
    integrationId: string,
    from: string,
    to: string,
    compare: boolean
  ) {
    const overview = await this.getOverview(
      org,
      from,
      to,
      [integrationId],
      compare
    );
    const channelInfo = await this.getIntegrations(org.id, [integrationId]);
    const integration = channelInfo[0];

    return {
      ...overview,
      integrationId,
      name: integration?.name || '',
      identifier: integration?.providerIdentifier || '',
      picture: integration?.picture || null,
    };
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
    const campaignIds = opts.campaignIds ?? [];
    const scoped = campaignIds.length > 0;
    const fromDate = dayjs(from).startOf('day').toDate();
    const toDate = dayjs(to).endOf('day').toDate();

    const dbIntegrations = await this.getIntegrations(org.id, integrationIds);
    const ids = dbIntegrations.map((i) => i.id);
    // Under campaign scope the post list/metrics/count come from the
    // campaign-scoped repo reads (Post.campaignId); an explicit integration
    // filter, if any, narrows the metric snapshots. No live fallback here (the
    // posts path never had one).
    const filterIds = ids.length ? ids : undefined;

    const postSnapshots = scoped
      ? await this.analyticsRepository.getPostSnapshotsByCampaigns(
          org.id,
          campaignIds,
          fromDate,
          toDate,
          filterIds
        )
      : await this.getPostSnapshots(org.id, ids, fromDate, toDate);

    // Post-snapshot values are cumulative lifetime LEVELS (R1.2), so a post's
    // per-metric number is its LAST level in the window — never the sum of its
    // snapshot rows (which inflates by the number of snapshot days and biases
    // sort toward older posts). Rows arrive date-ascending, so last write wins.
    const postMetrics: Record<string, Record<string, number>> = {};
    for (const snap of postSnapshots) {
      if (!postMetrics[snap.postId]) postMetrics[snap.postId] = {};
      postMetrics[snap.postId][snap.metric] = snap.value;
    }

    const p = Math.max(1, page || 1);
    const l = Math.min(100, Math.max(1, limit || 20));

    const hasValidSort = sort && isKnownMetric(sort);

    const posts = scoped
      ? await this.analyticsRepository.getPostsByCampaigns(
          org.id,
          campaignIds,
          fromDate,
          toDate,
          hasValidSort ? undefined : (p - 1) * l,
          hasValidSort ? undefined : l
        )
      : await this.analyticsRepository.findPosts(
          org.id,
          ids,
          fromDate,
          toDate,
          hasValidSort ? undefined : (p - 1) * l,
          hasValidSort ? undefined : l
        );

    const enriched = posts.map((p) => {
      const metrics = postMetrics[p.id] || {};
      return {
        postId: p.id,
        content: p.content?.substring(0, 200) || '',
        integration: {
          id: p.integration.id,
          name: p.integration.name,
          identifier: p.integration.providerIdentifier,
          picture: p.integration.picture,
        },
        publishedAt: p.publishDate.toISOString(),
        metrics,
      };
    });

    if (hasValidSort) {
      enriched.sort((a, b) => {
        const aVal = (a.metrics as any)[sort!] || 0;
        const bVal = (b.metrics as any)[sort!] || 0;
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    const total = scoped
      ? await this.analyticsRepository.countPostsByCampaigns(org.id, campaignIds, fromDate, toDate)
      : await this.analyticsRepository.countPosts(org.id, ids, fromDate, toDate);

    const paginated = hasValidSort
      ? enriched.slice((p - 1) * l, p * l)
      : enriched;

    return { posts: paginated, total };
  }

  async getPostDetail(org: Organization, postId: string, date?: string) {
    const post = await this.analyticsRepository.findPost(org.id, postId);

    if (!post) throw new NotFoundException('Post not found');

    const daysBack = Math.max(1, Math.min(365, parseInt(date || '30', 10) || 30));
    const toDate = dayjs().endOf('day').toDate();
    const fromDate = dayjs().subtract(daysBack, 'day').startOf('day').toDate();

    let snapshots = await this.analyticsRepository.getPostDetailSnapshots(org.id, postId, fromDate, toDate);

    if (snapshots.length === 0) {
      try {
        const postAnalytics = await this.postsService.checkPostAnalytics(
          org.id,
          postId,
          daysBack
        );
        if (
          postAnalytics &&
          !('missing' in postAnalytics) &&
          Array.isArray(postAnalytics) &&
          postAnalytics.length > 0
        ) {
          const providerData = { [post.integrationId]: postAnalytics };
          const integrationMap = {
            [post.integrationId]: post.integration.providerIdentifier,
          };
          const liveRows = this.liveFallback.convertLiveToSnapshots(
            providerData,
            org.id,
            integrationMap,
            fromDate,
            toDate,
          );
          if (liveRows.length > 0) {
            snapshots = liveRows.map((r) => ({
              ...r,
              id: '',
              postId,
              createdAt: new Date(),
              integration: {} as any,
            }));
          }
        }
      } catch (err) {
        this._logger.error(`getPostDetail live-fallback failed for post ${postId}: ${(err as Error)?.message}`);
      }
    }

    const metrics: Record<string, MetricSeries[]> = {};
    for (const snap of snapshots) {
      if (!metrics[snap.metric]) metrics[snap.metric] = [];
      metrics[snap.metric].push({
        date: dayjs(snap.date).format('YYYY-MM-DD'),
        value: snap.value,
      });
    }

    return {
      postId: post.id,
      content: post.content,
      integration: {
        id: post.integration.id,
        name: post.integration.name,
        identifier: post.integration.providerIdentifier,
        picture: post.integration.picture,
      },
      publishedAt: post.publishDate.toISOString(),
      metrics,
    };
  }

  // ── 6.7: on-demand channel refresh ──
  // Calls the SAME IntegrationService.checkAnalytics the live fallback uses (its
  // integration:* ioRedis cache still applies) and persists the returned series
  // through the SAME upsert the daily sweep uses, so a refresh is durable — not
  // a cosmetic one-off read. Provider errors are surfaced (not swallowed) so the
  // controller returns an HTTP error the frontend can toast.
  async refreshChannel(org: Organization, integrationId: string) {
    const [integration] = await this.analyticsRepository.getIntegrations(
      org.id,
      [integrationId]
    );
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    let data;
    try {
      data = await this.integrationService.checkAnalytics(
        org,
        integrationId,
        String(REFRESH_WINDOW_DAYS)
      );
    } catch (err) {
      // Provider/token failures surface as a 502 (frontend toast) rather than a
      // 500 — the request itself was well-formed.
      throw new BadGatewayException(
        `Failed to refresh analytics: ${(err as Error)?.message || 'provider error'}`
      );
    }

    const fromDate = dayjs()
      .subtract(REFRESH_WINDOW_DAYS, 'day')
      .startOf('day')
      .toDate();
    const toDate = dayjs().endOf('day').toDate();

    const rows = this.liveFallback.convertLiveToSnapshots(
      { [integrationId]: Array.isArray(data) ? data : [] },
      org.id,
      { [integrationId]: integration.providerIdentifier },
      fromDate,
      toDate
    );

    // R4.2: chunked concurrency instead of ~240 sequential upserts per click.
    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await Promise.all(
        rows
          .slice(i, i + CHUNK)
          .map((row) => this.analyticsRepository.upsertChannelSnapshot(row))
      );
    }

    return { integrationId, refreshed: true, persisted: rows.length };
  }

  // ── 6.6: data-health panel (trust surface) ──
  // Per integration: does its provider implement analytics() (reuse the
  // live-fallback capability check), its last snapshot date, and window coverage
  // % (the 0.6 distinct-(integration,date) heuristic). Unsupported channels are
  // labeled, not zeroed, so "why is my number wrong" becomes self-service.
  async getDataHealth(org: Organization): Promise<DataHealthItem[]> {
    const integrations =
      await this.analyticsRepository.getBestTimeIntegrations(org.id);
    if (integrations.length === 0) return [];

    const supportingIds = new Set(
      this.liveFallback.analyticsSupportingIds(integrations)
    );

    const from = dayjs()
      .subtract(HEALTH_WINDOW_DAYS - 1, 'day')
      .startOf('day')
      .toDate();
    const to = dayjs().endOf('day').toDate();
    const ids = integrations.map((i) => i.id);

    const [coveragePairs, lastDates] = await Promise.all([
      this.analyticsRepository.checkCoverage(org.id, ids, from, to),
      this.analyticsRepository.getLastSnapshotDates(org.id, ids),
    ]);

    // distinct dates present per integration in the window.
    const daysCovered: Record<string, number> = {};
    for (const pair of coveragePairs) {
      daysCovered[pair.integrationId] =
        (daysCovered[pair.integrationId] || 0) + 1;
    }

    const lastByInt: Record<string, Date> = {};
    for (const row of lastDates) {
      if (row.date) lastByInt[row.integrationId] = row.date;
    }

    const staleCutoff = dayjs().subtract(48, 'hour');

    return integrations.map((int) => {
      const supportsAnalytics = supportingIds.has(int.id);
      const last = lastByInt[int.id] || null;
      const coverage = supportsAnalytics
        ? (daysCovered[int.id] || 0) / HEALTH_WINDOW_DAYS
        : 0;
      const stale =
        supportsAnalytics && (!last || dayjs(last).isBefore(staleCutoff));

      return {
        integrationId: int.id,
        name: int.name,
        identifier: int.providerIdentifier,
        picture: int.picture,
        supportsAnalytics,
        lastSnapshotDate: last ? dayjs(last).format('YYYY-MM-DD') : null,
        coverage,
        stale,
      };
    });
  }
}
