// Best-time + recommendations insight compute extracted from
// analytics.service.ts (5.3, 0.1/2G/2H). Self-contained: it only needs the
// AnalyticsRepository, and getRecommendations reuses this service's own
// getBestTimeData — no facade dependency, so no DI cycle. The facade delegates
// getBestTimeAnalyticsContext/getBestTimeData/getRecommendations here.

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  BestTimeEntry,
  ContentInsightFinding,
  MetricSeries,
} from './analytics.types';
import {
  bestTimeConfidence,
  buildFilledDayMap,
  computeContentInsights,
  ContentInsightPost,
} from './analytics-aggregation';
import { AnalyticsOverviewService } from './analytics-overview.service';

dayjs.extend(utc);
dayjs.extend(timezone);

// Standard no-provider message (7.5). Mirrors AIModelProvider's own message; the
// no-provider rule is absolute — NO env-key fallback, ever.
const AI_NOT_CONFIGURED_MESSAGE =
  'AI is not configured for this organization. Go to Settings → AI to configure a provider.';

@Injectable()
export class AnalyticsInsightsService {
  constructor(
    private analyticsRepository: AnalyticsRepository,
    private aiModelProvider: AIModelProvider,
    private overviewService: AnalyticsOverviewService,
  ) {}

  async getBestTimeAnalyticsContext(orgId: string) {
    const ninetyDaysAgo = dayjs().subtract(90, 'day').startOf('day').toDate();

    const integrations = await this.analyticsRepository.getBestTimeIntegrations(orgId);

    const integrationIds = integrations.map((i) => i.id);

    const [recentPosts, snapshots] = await Promise.all([
      integrationIds.length > 0
        ? this.analyticsRepository.getBestTimePosts(orgId, integrationIds, ninetyDaysAgo)
        : Promise.resolve([]),

      integrationIds.length > 0
        ? this.analyticsRepository.getBestTimeSnapshots(orgId, integrationIds, ninetyDaysAgo, [
            'impressions',
            'likes',
            'comments',
            'shares',
            'clicks',
            'engagement',
            'reach',
            'views',
          ])
        : Promise.resolve([]),
    ]);

    return { integrations, posts: recentPosts, snapshots };
  }

  async getRecommendations(
    org: Organization,
  ) {
    const ninetyDaysAgo = dayjs().subtract(90, 'day').startOf('day').toDate();
    const integrations = await this.analyticsRepository.getBestTimeIntegrations(org.id);
    const integrationIds = integrations.map((i) => i.id);

    const snapshots = integrationIds.length > 0
      ? await this.analyticsRepository.getSnapshots(org.id, integrationIds, ninetyDaysAgo, new Date())
      : [];

    // Real previous-window baseline (0.1): the 90 days before the current window,
    // per integration, instead of the old `impressions * 0.7` fabrication.
    const prevWindowFrom = dayjs().subtract(180, 'day').startOf('day').toDate();
    const prevImpressionsByInt = integrationIds.length > 0
      ? await this.analyticsRepository.sumFlowMetric(
          org.id,
          integrationIds,
          'impressions',
          prevWindowFrom,
          ninetyDaysAgo,
        )
      : {};

    const postSnapshots = integrationIds.length > 0
      ? await this.analyticsRepository.getPostSnapshots(org.id, integrationIds, ninetyDaysAgo, new Date())
      : [];

    const recommendations: {
      type: string;
      title: string;
      description: string;
      action: string;
      link: string;
      priority: number;
    }[] = [];

    // Underperforming channels — channels with >20% decline in primary metric
    const metricByInt: Record<string, Record<string, number>> = {};
    for (const snap of snapshots) {
      if (!metricByInt[snap.integrationId]) metricByInt[snap.integrationId] = {};
      metricByInt[snap.integrationId][snap.metric] = (metricByInt[snap.integrationId][snap.metric] || 0) + snap.value;
    }

    for (const int of integrations) {
      const impressions = metricByInt[int.id]?.impressions || 0;
      const prevImpressions = prevImpressionsByInt[int.id] || 0;
      // Fire only on a real decline vs the prior window, and only when the prior
      // window has enough signal to be meaningful (≥100 impressions).
      if (prevImpressions >= 100 && impressions < prevImpressions * 0.75) {
        recommendations.push({
          type: 'underperforming',
          title: `Engagement drop on ${int.name}`,
          description: 'Impressions are significantly below average. Review your recent posts on this channel.',
          action: 'View channel',
          link: `/analytics/v2?tab=channels&focusIntegration=${int.id}`,
          priority: 3,
        });
      }
    }

    // Missing analytics coverage
    if (snapshots.length === 0) {
      recommendations.push({
        type: 'no_coverage',
        title: 'No analytics data collected yet',
        description: 'Analytics snapshots are not available. Ensure the collection workflow is enabled.',
        action: 'Configure analytics',
        link: `/settings`,
        priority: 1,
      });
    }

    // Best-time opportunity
    const bestTime = await this.getBestTimeData(org.id, integrationIds);
    if (bestTime.bestSlots.length > 0) {
      const slot = bestTime.bestSlots[0];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      recommendations.push({
        type: 'best_time',
        title: `Best time to post: ${dayNames[slot.day]} at ${slot.hour}:00`,
        description: `Your content gets the highest engagement when posted at this time. Try scheduling more posts here.`,
        action: 'Schedule a post',
        link: `/posts`,
        priority: 2,
      });
    }

    // Top post patterns — find the best-performing post content pattern.
    // Post-snapshot values are cumulative LEVELS (R1.2): rank by each post's
    // latest level (rows are date-ascending; last write wins), never the sum
    // of its snapshot rows.
    const postMetrics: Record<string, number> = {};
    for (const snap of postSnapshots) {
      if (snap.metric === 'impressions' || snap.metric === 'engagement') {
        postMetrics[snap.postId] = snap.value;
      }
    }

    const topPostIds = Object.entries(postMetrics)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([id]) => id);

    if (topPostIds.length > 0) {
      recommendations.push({
        type: 'top_posts',
        title: 'Review your top-performing content',
        description: `${topPostIds.length} posts significantly outperform others. Review their patterns and replicate what works.`,
        action: 'View top posts',
        link: `/analytics/v2?tab=posts`,
        priority: 2,
      });
    }

    // Comment-response backlog — count unread comments
    try {
      const backlogCount = await this.analyticsRepository.getCommentBacklogCount(org.id);
      if (backlogCount > 5) {
        recommendations.push({
          type: 'comment_backlog',
          title: `${backlogCount} comments waiting for reply`,
          description: 'Several comments need attention. Responding quickly improves engagement metrics.',
          action: 'Open inbox',
          link: `/comments`,
          priority: 1,
        });
      }
    } catch {
      // comments feature may not be available
    }

    recommendations.sort((a, b) => a.priority - b.priority);
    return { recommendations };
  }

  // 6.4 — best-time v2: optional per-channel grouping (integrationIds), a
  // caller-passed IANA `tz` (post dates are stored UTC, so without this the
  // heatmap is silently UTC-shifted for most users), and a sample-size
  // confidence tier per slot. Passing no tz preserves the legacy server-local
  // bucketing byte-for-byte (existing composer path unaffected).
  async getBestTimeData(
    orgId: string,
    integrationIds?: string[],
    tz?: string,
  ) {
    const context = await this.getBestTimeAnalyticsContext(orgId);

    const { posts } = context;

    const filteredPosts = integrationIds?.length
      ? posts.filter((p) => integrationIds.includes(p.integrationId))
      : posts;

    // Validate the tz once; an invalid zone falls back to legacy behaviour
    // rather than throwing on every post.
    const useTz = tz ? this.isValidTz(tz) : false;

    const dayHourMap = new Map<string, { engagement: number; count: number }>();

    for (const post of filteredPosts) {
      const date = useTz
        ? dayjs(post.publishDate).tz(tz)
        : dayjs(post.publishDate);
      const day = date.day();
      const hour = date.hour();
      const key = `${day}-${hour}`;
      const engagement = (post.lastViews || 0) + (post.lastLikes || 0) + (post.lastComments || 0);

      if (!dayHourMap.has(key)) {
        dayHourMap.set(key, { engagement: 0, count: 0 });
      }
      const entry = dayHourMap.get(key)!;
      entry.engagement += engagement;
      entry.count += 1;
    }

    const heatmap: BestTimeEntry[] = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const key = `${day}-${hour}`;
        const entry = dayHourMap.get(key);
        const postCount = entry?.count || 0;
        heatmap.push({
          day,
          hour,
          engagement: entry?.engagement || 0,
          postCount,
          avgEngagement: entry ? Math.round(entry.engagement / entry.count) : 0,
          confidence: bestTimeConfidence(postCount),
        });
      }
    }

    const bestSlots = heatmap
      .filter((e) => e.postCount > 0)
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 10)
      .map(({ day, hour, avgEngagement, postCount, confidence }) => ({
        day,
        hour,
        avgEngagement,
        postCount,
        confidence,
      }));

    return { heatmap, bestSlots, tz: useTz ? tz : null };
  }

  private isValidTz(tz: string): boolean {
    try {
      // Intl throws RangeError on an unknown zone.
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  // 6.3 — own-channel follower series for the competitor overlay. Daily-filled
  // followers (a stock metric — carry-forward) summed across all org channels.
  async getFollowerSeries(
    orgId: string,
    from: string,
    to: string,
  ): Promise<MetricSeries[]> {
    const fromDate = dayjs(from).startOf('day').toDate();
    const toDate = dayjs(to).endOf('day').toDate();
    const integrations =
      await this.analyticsRepository.getBestTimeIntegrations(orgId);
    const ids = integrations.map((i) => i.id);
    if (ids.length === 0) return [];

    const snapshots = await this.analyticsRepository.getSnapshots(
      orgId,
      ids,
      fromDate,
      toDate,
    );
    const dayMap = buildFilledDayMap(
      snapshots,
      'followers',
      fromDate,
      toDate,
      'stock',
      0,
    );
    return Object.entries(dayMap).map(([date, value]) => ({ date, value }));
  }

  // 7.4 — content-attribute intelligence. Fetches 90-day posts + their sweep
  // engagement counters and runs the pure bucketing/comparison (min-sample
  // guarded). Zero posts → empty findings.
  async getContentInsights(
    org: Organization,
  ): Promise<{
    findings: ContentInsightFinding[];
    totalPosts: number;
    orgMean: number;
  }> {
    const ninetyDaysAgo = dayjs().subtract(90, 'day').startOf('day').toDate();
    const rows = await this.analyticsRepository.getContentInsightPosts(
      org.id,
      ninetyDaysAgo,
    );

    const posts: ContentInsightPost[] = rows.map((p) => ({
      image: p.image ?? null,
      content: p.content || '',
      campaignId: p.campaignId ?? null,
      publishDate: p.publishDate,
      engagement:
        (p.lastViews || 0) + (p.lastLikes || 0) + (p.lastComments || 0),
    }));

    return computeContentInsights(posts);
  }

  // 7.5 — LLM-narrated summary. Assembles overview + content-insights +
  // anomalies JSON and asks the utility-scope model to explain the period. The
  // no-provider rule is ABSOLUTE: if resolveConfigForScope returns null the
  // request fails with the standard "AI not configured" error — NO env-key
  // fallback, ever.
  async narrate(
    org: Organization,
    from: string,
    to: string,
  ): Promise<{ narrative: string }> {
    const config = await this.aiModelProvider.resolveConfigForScope(
      'utility',
      org.id,
    );
    if (!config) {
      throw new ServiceUnavailableException(AI_NOT_CONFIGURED_MESSAGE);
    }

    const [overview, content, anomalies] = await Promise.all([
      this.overviewService.getOverview(org, from, to, [], false),
      this.getContentInsights(org),
      this.analyticsRepository.listAnomalies(org.id, { limit: 10 }),
    ]);

    const context = {
      range: { from, to },
      kpis: overview.kpis.map((k) => ({
        metric: k.metric,
        label: k.label,
        total: k.total,
      })),
      derived: overview.derived,
      byChannel: overview.byChannel.map((c) => ({
        name: c.name,
        identifier: c.identifier,
        kpis: c.kpis.map((k) => ({ metric: k.metric, total: k.total })),
      })),
      contentFindings: content.findings.slice(0, 8).map((f) => ({
        dimension: f.dimension,
        bucket: f.bucket,
        sampleSize: f.sampleSize,
        ratio: Number(f.ratio.toFixed(2)),
        direction: f.direction,
      })),
      anomalies: anomalies.map((a: any) => ({
        metric: a.metric,
        direction: a.direction,
        deviation: a.deviation,
        channel: a.integration?.name,
      })),
    };

    const system =
      'You are a social-media analytics assistant. Given a JSON summary of an ' +
      "organization's analytics for a period, write a concise, plain-language " +
      'narrative (3-5 short paragraphs) explaining what happened and why: the ' +
      'headline movements, the best/worst channels, notable content patterns, ' +
      'and any anomalies. Be specific with numbers. Do not invent data not in ' +
      'the JSON. Do not use markdown headers.';

    const prompt = `Analytics summary JSON:\n${JSON.stringify(context)}`;

    const narrative = await this.aiModelProvider.generateText('utility', prompt, {
      orgId: org.id,
      system,
    });

    return { narrative };
  }
}
