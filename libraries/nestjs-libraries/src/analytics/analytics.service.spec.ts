import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics.service';
import {
  computeDerivedMetrics,
  computeContentInsights,
  bestTimeConfidence,
} from './analytics-aggregation';
import { METRIC_REGISTRY, isKnownMetric } from '@gitroom/nestjs-libraries/integrations/social/analytics.metrics';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';

vi.mock('@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository', () => {
  const mkMock = () => {
    const fn = vi.fn();
    // Default to resolving empty arrays so un-mocked calls don't crash
    fn.mockResolvedValue([]);
    return fn;
  };
  return {
    AnalyticsRepository: class MockAnalyticsRepository {
      getSnapshots = mkMock();
      getPostSnapshots = mkMock();
      getPostSnapshotsByCampaigns = mkMock();
      getLatestPostSnapshotsBeforeByCampaigns = mkMock();
      getPostsByCampaigns = mkMock();
      countPostsByCampaigns = (() => { const fn = vi.fn(); fn.mockResolvedValue(0); return fn; })();
      getIntegrations = mkMock();
      checkCoverage = mkMock();
      sumFlowMetric = (() => { const fn = vi.fn(); fn.mockResolvedValue({}); return fn; })();
      findPosts = mkMock();
      countPosts = mkMock();
      findPost = mkMock();
      getPostDetailSnapshots = mkMock();
      getMetricDetailTopPosts = mkMock();
      getDayAnalyticsSnapshots = mkMock();
      getDayPostSnapshots = mkMock();
      getChannelAnalyticsSnapshots = mkMock();
      getChannelPostSnapshots = mkMock();
      getBestTimeIntegrations = mkMock();
      getBestTimePosts = mkMock();
      getBestTimeSnapshots = mkMock();
      getLastSnapshotDates = mkMock();
      getContentInsightPosts = mkMock();
      upsertChannelSnapshot = mkMock();
      listAnomalies = mkMock();
    },
  };
});

vi.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class MockManager {},
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class MockService {
    checkAnalytics = vi.fn();
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class MockService {
    checkPostAnalytics = vi.fn();
  },
}));

// 7.5: insights injects AIModelProvider — mock the heavy module so importing the
// insights service in the spec doesn't drag in the whole AI stack.
vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class MockAIModelProvider {
    resolveConfigForScope = vi.fn().mockResolvedValue(null);
    generateText = vi.fn().mockResolvedValue('');
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service', () => ({
  OrgShortLinkSettingsService: class MockOrgShortLinkSettingsService {
    getLinksForOrg = vi.fn();
    getAggregatedClicks = vi.fn();
  },
}));

// Mock ioRedis to prevent cache cross-contamination between tests
vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(0),
  },
  RedisService: class {
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    exists = vi.fn().mockResolvedValue(0);
    client = {};
  },
}));

import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
// 5.3: the facade delegates to these sibling services. They are constructed
// from the same mocks so every assertion below still exercises the real logic
// through the facade — no behaviour change, only the wiring moved.
import { AnalyticsLiveFallbackService } from './analytics-live-fallback';
import { AnalyticsOverviewService } from './analytics-overview.service';
import { AnalyticsDetailService } from './analytics-detail.service';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsExportService } from './analytics-export.service';

// Helper: create local-midnight dates to avoid timezone offset in dayjs formatting
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let analyticsRepository: AnalyticsRepository;
  let integrationService: IntegrationService;
  let postsService: PostsService;
  let shortLinkSettingsService: OrgShortLinkSettingsService;
  let aiModelProvider: any;

  const mockOrg = { id: 'org1', name: 'Test Org' } as any;

  const mockIntegration = {
    id: 'i1', name: 'Test Channel', providerIdentifier: 'instagram',
    picture: 'https://example.com/pic.jpg', organizationId: 'org1',
    disabled: false, deletedAt: null, type: 'social', token: 'tok',
    createdAt: new Date(), updatedAt: null,
  };

  const mockIntegration2 = {
    id: 'i2', name: 'Test Channel 2', providerIdentifier: 'tiktok',
    picture: null, organizationId: 'org1',
    disabled: false, deletedAt: null, type: 'social', token: 'tok',
    createdAt: new Date(), updatedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    analyticsRepository = new AnalyticsRepository();
    // 0.6: checkCoverage now excludes no-analytics providers from the denominator
    // via manager.getSocialIntegrationUnchecked(...).analytics. The fixtures use
    // instagram/tiktok integrations, which implement analytics() in production.
    const withAnalytics = [
      'instagram', 'tiktok', 'facebook', 'linkedin', 'linkedin-page',
      'youtube', 'x', 'pinterest', 'threads', 'bluesky', 'mastodon', 'reddit',
    ];
    const manager = {
      getSocialIntegrationUnchecked: vi.fn((identifier: string) =>
        withAnalytics.includes(identifier) ? { analytics: vi.fn() } : {},
      ),
    } as any;
    integrationService = new IntegrationService();
    postsService = new PostsService();
    shortLinkSettingsService = new OrgShortLinkSettingsService();
    const mockRedisService = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1), exists: vi.fn().mockResolvedValue(0), client: {} };
    const liveFallback = new AnalyticsLiveFallbackService(analyticsRepository, manager, integrationService);
    const overview = new AnalyticsOverviewService(analyticsRepository, liveFallback, postsService, mockRedisService as any, integrationService);
    const detail = new AnalyticsDetailService(analyticsRepository, liveFallback);
    // 7.5: insights now injects AIModelProvider (narration) + the overview
    // service (narrate assembles the overview). Stubbed so the existing
    // best-time / recommendations tests keep exercising the real logic.
    aiModelProvider = {
      resolveConfigForScope: vi.fn().mockResolvedValue(null),
      generateText: vi.fn().mockResolvedValue('narrative text'),
    } as any;
    const insights = new AnalyticsInsightsService(analyticsRepository, aiModelProvider, overview);
    const exportSvc = new AnalyticsExportService();
    service = new AnalyticsService(analyticsRepository, shortLinkSettingsService, overview, detail, insights, exportSvc, liveFallback);
  });

  // ============ EXISTING TESTS (kept exactly) ============

  describe('computePercentageChange', () => {
    it('returns null when previous is 0 and current is non-zero', () => {
      const result = (service as any).computePercentageChange(100, 0, 'count');
      expect(result).toBeNull();
    });

    it('returns 0 when both current and previous are 0', () => {
      const result = (service as any).computePercentageChange(0, 0, 'count');
      expect(result).toBe(0);
    });

    it('returns null when previous is null', () => {
      const result = (service as any).computePercentageChange(100, null, 'count');
      expect(result).toBeNull();
    });

    it('computes percentage change for count metrics', () => {
      const result = (service as any).computePercentageChange(150, 100, 'count');
      expect(result).toBe(50);
    });

    it('computes negative percentage change', () => {
      const result = (service as any).computePercentageChange(50, 100, 'count');
      expect(result).toBe(-50);
    });

    it('returns percentage-point delta for percent metrics', () => {
      const result = (service as any).computePercentageChange(65, 50, 'percent');
      expect(result).toBe(15);
    });

    it('returns negative pp delta for percent metrics', () => {
      const result = (service as any).computePercentageChange(30, 50, 'percent');
      expect(result).toBe(-20);
    });

    it('returns null when current positive and previous 0', () => {
      expect((service as any).computePercentageChange(50, 0, 'count')).toBeNull();
    });
  });

  describe('getMetricDef', () => {
    it('returns known metric definition', () => {
      const def = (service as any).getMetricDef('impressions');
      expect(def.label).toBe('Impressions');
      expect(def.format).toBe('count');
      expect(def.kind).toBe('flow');
    });

    it('returns default definition for unknown metric', () => {
      const def = (service as any).getMetricDef('unknown_metric');
      expect(def.label).toBe('unknown_metric');
      expect(def.format).toBe('count');
      expect(def.kind).toBe('flow');
    });
  });

  describe('aggregateSnapshots', () => {
    const snapshots = [
      { integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1) },
      { integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2) },
      { integrationId: 'i2', metric: 'impressions', value: 300, date: d(2024, 1, 1) },
    ];

    it('sums flow metrics across all integrations and dates', () => {
      const result = (service as any).aggregateSnapshots(snapshots, 'impressions');
      expect(result).toBe(600);
    });

    it('takes latest value per integration for stock metrics', () => {
      const stockSnapshots = [
        { integrationId: 'i1', metric: 'followers', value: 1000, date: d(2024, 1, 1) },
        { integrationId: 'i1', metric: 'followers', value: 1100, date: d(2024, 1, 2) },
        { integrationId: 'i2', metric: 'followers', value: 500, date: d(2024, 1, 1) },
      ];
      const result = (service as any).aggregateSnapshots(stockSnapshots, 'followers');
      expect(result).toBe(1600);
    });

    it('returns 0 for empty snapshots', () => {
      expect((service as any).aggregateSnapshots([], 'impressions')).toBe(0);
    });

    it('averages percent-flow metrics', () => {
      const s = [
        { integrationId: 'i1', metric: 'avg_view_percentage', value: 50, date: d(2024, 1, 1) },
        { integrationId: 'i1', metric: 'avg_view_percentage', value: 70, date: d(2024, 1, 2) },
      ];
      expect((service as any).aggregateSnapshots(s, 'avg_view_percentage')).toBe(60);
    });

    it('sums latest per integration for stock-count metrics', () => {
      const s = [
        { integrationId: 'i1', metric: 'followers', value: 1000, date: d(2024, 1, 1) },
        { integrationId: 'i1', metric: 'followers', value: 2000, date: d(2024, 1, 2) },
        { integrationId: 'i2', metric: 'followers', value: 3000, date: d(2024, 1, 1) },
      ];
      expect((service as any).aggregateSnapshots(s, 'followers')).toBe(5000);
    });

    it('returns 0 when percent-stock (no data) returns 0', () => {
      expect((service as any).aggregateSnapshots([], 'followers')).toBe(0);
    });

    it('returns 0 when percent-flow has no data', () => {
      expect((service as any).aggregateSnapshots([], 'avg_view_percentage')).toBe(0);
    });
  });

  describe('getOverview (empty)', () => {
    it('returns empty overview when no integrations match', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      const result = await service.getOverview(mockOrg as any, '2024-01-01', '2024-01-07', ['i1'], false);
      expect(result.kpis).toHaveLength(0);
      expect(result.series).toEqual({});
      expect(result.byChannel).toHaveLength(0);
      expect(result.breakdown.byPlatform).toHaveLength(0);
    });
  });

  describe('getOverview (single-flight, G5)', () => {
    it('collapses two concurrent same-key cache-miss calls into one compute', async () => {
      // Hold the first compute open at its first awaited DB call so the second
      // concurrent call attaches to the in-flight promise instead of recomputing.
      let releaseCompute!: (value: any[]) => void;
      const gate = new Promise<any[]>((resolve) => {
        releaseCompute = resolve;
      });
      (analyticsRepository.getIntegrations as any).mockReturnValue(gate);

      const p1 = service.getOverview(mockOrg as any, '2024-03-01', '2024-03-07', ['i1'], false);
      const p2 = service.getOverview(mockOrg as any, '2024-03-01', '2024-03-07', ['i1'], false);

      // Drain microtasks so both calls pass the Redis miss and reach singleFlight.
      await new Promise((r) => setTimeout(r, 0));
      releaseCompute([]); // no integrations -> deterministic short compute

      const [r1, r2] = await Promise.all([p1, p2]);

      // One compute: getIntegrations invoked once, and both callers share the result.
      expect((analyticsRepository.getIntegrations as any)).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
    });
  });

  // ============ NEW PRIVATE METHOD TESTS ============

  describe('escapeCSVField', () => {
    it('returns normal string unchanged', () => {
      expect((service as any).escapeCSVField('hello')).toBe('hello');
    });
    it('quotes field containing comma', () => {
      expect((service as any).escapeCSVField('hello,world')).toBe('"hello,world"');
    });
    it('escapes double quotes', () => {
      expect((service as any).escapeCSVField('say "hi"')).toBe('"say ""hi"""');
    });
    it('quotes field containing newline', () => {
      expect((service as any).escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
    });
    it('quotes field containing carriage return', () => {
      expect((service as any).escapeCSVField('line1\rline2')).toBe('"line1\rline2"');
    });
    it('converts number to string', () => {
      expect((service as any).escapeCSVField(42)).toBe('42');
    });
    it('handles empty string', () => {
      expect((service as any).escapeCSVField('')).toBe('');
    });
  });

  describe('checkCoverage (0.6 — per-integration denominator)', () => {
    const from = d(2024, 1, 1);
    const to = d(2024, 1, 3); // 3-day window
    const ig = (id: string) => ({ id, providerIdentifier: 'instagram' });
    const discord = (id: string) => ({ id, providerIdentifier: 'discord' });
    const pair = (id: string, date: Date) => ({ integrationId: id, date });

    it('returns 1.0 when the single channel is fully covered', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([
        pair('i1', d(2024, 1, 1)), pair('i1', d(2024, 1, 2)), pair('i1', d(2024, 1, 3)),
      ]);
      expect(await (service as any).checkCoverage('org1', [ig('i1')], from, to)).toBe(1);
    });

    it('returns partial coverage for one channel', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([pair('i1', d(2024, 1, 1))]);
      expect(await (service as any).checkCoverage('org1', [ig('i1')], from, to)).toBeCloseTo(1 / 3, 5);
    });

    // Headline 0.6 case: two channels, one fully covered, one empty → 0.5 (was 1.0).
    it('returns 0.5 when one of two channels is entirely missing', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([
        pair('i1', d(2024, 1, 1)), pair('i1', d(2024, 1, 2)), pair('i1', d(2024, 1, 3)),
      ]);
      expect(
        await (service as any).checkCoverage('org1', [ig('i1'), ig('i2')], from, to),
      ).toBeCloseTo(0.5, 5);
    });

    // No-analytics providers must not count toward the denominator.
    it('excludes no-analytics providers from the denominator', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([
        pair('i1', d(2024, 1, 1)), pair('i1', d(2024, 1, 2)), pair('i1', d(2024, 1, 3)),
      ]);
      // i1 instagram (supports analytics) fully covered, i2 discord (no analytics)
      // excluded → denominator is 1 channel × 3 days → 1.0, not 0.5.
      expect(
        await (service as any).checkCoverage('org1', [ig('i1'), discord('i2')], from, to),
      ).toBe(1);
    });

    it('returns 1 (skips fallback) when no channel supports analytics', async () => {
      expect(
        await (service as any).checkCoverage('org1', [discord('i1'), discord('i2')], from, to),
      ).toBe(1);
    });

    it('returns 0 when the covered channel has no pairs', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([]);
      expect(await (service as any).checkCoverage('org1', [ig('i1')], from, to)).toBe(0);
    });

    it('returns 0 when from or to null', async () => {
      expect(await (service as any).checkCoverage('org1', [ig('i1')], null, to)).toBe(0);
    });

    it('returns 0 when totalDays <= 0', async () => {
      (analyticsRepository.checkCoverage as any).mockResolvedValue([]);
      expect(await (service as any).checkCoverage('org1', [ig('i1')], d(2024, 1, 5), d(2024, 1, 1))).toBe(0);
    });
  });

  describe('fetchLiveFallback', () => {
    const from = d(2024, 1, 1);
    const to = d(2024, 1, 3);

    it('returns data per integration', async () => {
      (integrationService.checkAnalytics as any).mockResolvedValue([{ label: 'Likes', data: [{ date: '2024-01-02', total: 100 }] }]);
      const result = await (service as any).fetchLiveFallback(mockOrg as any, ['i1'], from, to);
      expect(result).toEqual({ i1: [{ label: 'Likes', data: [{ date: '2024-01-02', total: 100 }] }] });
    });

    it('silently catches errors per integration', async () => {
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('fail'));
      expect(await (service as any).fetchLiveFallback(mockOrg as any, ['i1'], from, to)).toEqual({});
    });

    it('returns undefined for non-array data', async () => {
      (integrationService.checkAnalytics as any).mockResolvedValue({ not: 'array' });
      const result = await (service as any).fetchLiveFallback(mockOrg as any, ['i1'], from, to);
      expect(result).toEqual({ i1: undefined });
    });
  });

  describe('convertLiveToSnapshots', () => {
    const from = d(2024, 1, 1);
    const to = d(2024, 1, 3);
    const integrationMap = { i1: 'instagram' };

    it('converts live data to snapshot rows with normalized metric', () => {
      const pd = { i1: [{ label: 'Likes', data: [{ date: '2024-01-02', total: 100 }] }] };
      const rows = (service as any).convertLiveToSnapshots(pd, 'org1', integrationMap, from, to);
      expect(rows[0]).toMatchObject({ organizationId: 'org1', integrationId: 'i1', metric: 'likes', value: 100 });
    });

    it('falls back to lowercased label when not in metric map', () => {
      const pd = { i1: [{ label: 'Custom Metric', data: [{ date: '2024-01-02', total: 50 }] }] };
      expect((service as any).convertLiveToSnapshots(pd, 'org1', { i1: 'unknown' }, from, to)[0].metric).toBe('custom_metric');
    });

    it('filters data points outside date range', () => {
      const pd = { i1: [{ label: 'Likes', data: [{ date: '2023-12-31', total: 50 }, { date: '2024-01-02', total: 200 }] }] };
      expect((service as any).convertLiveToSnapshots(pd, 'org1', integrationMap, from, to)).toHaveLength(1);
    });

    it('handles null provider data', () => {
      expect((service as any).convertLiveToSnapshots({ i1: null }, 'org1', integrationMap, from, to)).toHaveLength(0);
    });

    it('handles missing providerIdentifier gracefully', () => {
      const pd = { i1: [{ label: 'Likes', data: [{ date: '2024-01-02', total: 100 }] }] };
      expect((service as any).convertLiveToSnapshots(pd, 'org1', {}, from, to)[0].metric).toBe('likes');
    });

    it('handles item with no data array', () => {
      const pd = { i1: [{ label: 'Likes' }] };
      expect((service as any).convertLiveToSnapshots(pd, 'org1', integrationMap, from, to)).toHaveLength(0);
    });
  });

  describe('buildFilledDayMap', () => {
    const snapshots = [
      { date: d(2024, 1, 1), metric: 'impressions', value: 100, integrationId: 'i1' },
      { date: d(2024, 1, 2), metric: 'impressions', value: 200, integrationId: 'i1' },
      { date: d(2024, 1, 1), metric: 'impressions', value: 50, integrationId: 'i2' },
    ];
    const from = d(2024, 1, 1);
    const to = d(2024, 1, 3);

    it('sums flow metrics across integrations, zero-fills missing', () => {
      expect((service as any).buildFilledDayMap(snapshots, 'impressions', from, to, 'flow', 0))
        .toEqual({ '2024-01-01': 150, '2024-01-02': 200, '2024-01-03': 0 });
    });

    it('carries forward last value per integration for stock metrics', () => {
      const ss = [
        { date: d(2024, 1, 1), metric: 'followers', value: 1000, integrationId: 'i1' },
        { date: d(2024, 1, 2), metric: 'followers', value: 1100, integrationId: 'i1' },
        { date: d(2024, 1, 1), metric: 'followers', value: 500, integrationId: 'i2' },
      ];
      expect((service as any).buildFilledDayMap(ss, 'followers', from, to, 'stock', 0))
        .toEqual({ '2024-01-01': 1500, '2024-01-02': 1600, '2024-01-03': 1600 });
    });

    it('applies dateOffset to output keys', () => {
      expect((service as any).buildFilledDayMap(snapshots, 'impressions', from, to, 'flow', 1))
        .toEqual({ '2024-01-02': 150, '2024-01-03': 200, '2024-01-04': 0 });
    });

    it('returns all zeros for empty flow snapshots', () => {
      expect((service as any).buildFilledDayMap([], 'impressions', from, to, 'flow', 0))
        .toEqual({ '2024-01-01': 0, '2024-01-02': 0, '2024-01-03': 0 });
    });

    it('returns all zeros for empty stock snapshots', () => {
      expect((service as any).buildFilledDayMap([], 'followers', from, to, 'stock', 0))
        .toEqual({ '2024-01-01': 0, '2024-01-02': 0, '2024-01-03': 0 });
    });

    it('carries forward from first appearance for stock', () => {
      const ss = [{ date: d(2024, 1, 2), metric: 'followers', value: 500, integrationId: 'i1' }];
      expect((service as any).buildFilledDayMap(ss, 'followers', from, to, 'stock', 0))
        .toEqual({ '2024-01-01': 0, '2024-01-02': 500, '2024-01-03': 500 });
    });

    it('filters by metric and skips unmatched rows', () => {
      const ss = [
        { date: d(2024, 1, 1), metric: 'likes', value: 999, integrationId: 'i1' },
        { date: d(2024, 1, 2), metric: 'impressions', value: 200, integrationId: 'i1' },
      ];
      expect((service as any).buildFilledDayMap(ss, 'impressions', from, to, 'flow', 0))
        .toEqual({ '2024-01-01': 0, '2024-01-02': 200, '2024-01-03': 0 });
    });
  });

  describe('buildSparkline', () => {
    it('returns {date,value} for each day in range', () => {
      const ss = [
        { date: d(2024, 1, 1), metric: 'impressions', value: 100, integrationId: 'i1' },
        { date: d(2024, 1, 2), metric: 'impressions', value: 200, integrationId: 'i1' },
      ];
      expect((service as any).buildSparkline(ss, 'impressions', d(2024, 1, 1), d(2024, 1, 3)))
        .toEqual([{ date: '2024-01-01', value: 100 }, { date: '2024-01-02', value: 200 }, { date: '2024-01-03', value: 0 }]);
    });

    it('returns zero-filled array when no snapshots match', () => {
      expect((service as any).buildSparkline([], 'impressions', d(2024, 1, 1), d(2024, 1, 2)))
        .toEqual([{ date: '2024-01-01', value: 0 }, { date: '2024-01-02', value: 0 }]);
    });
  });

  describe('buildSeries', () => {
    it('builds series for each known metric', () => {
      const ss = [
        { date: d(2024, 1, 1), metric: 'impressions', value: 100, integrationId: 'i1' },
        { date: d(2024, 1, 2), metric: 'impressions', value: 200, integrationId: 'i1' },
        { date: d(2024, 1, 1), metric: 'likes', value: 10, integrationId: 'i1' },
      ];
      const result = (service as any).buildSeries(ss, d(2024, 1, 1), d(2024, 1, 2));
      expect(result).toHaveProperty('impressions');
      expect(result).toHaveProperty('likes');
      expect(result.impressions).toHaveLength(2);
      expect(result.likes).toHaveLength(2);
    });

    it('returns empty object when no known metrics', () => {
      const ss = [{ date: d(2024, 1, 1), metric: 'bogus', value: 100, integrationId: 'i1' }];
      expect((service as any).buildSeries(ss, d(2024, 1, 1), d(2024, 1, 1))).toEqual({});
    });

    it('returns empty object for empty input', () => {
      expect((service as any).buildSeries([], d(2024, 1, 1), d(2024, 1, 1))).toEqual({});
    });
  });

  describe('buildPrevMap', () => {
    it('returns date-offset map for known metrics', () => {
      const ss = [
        { date: d(2023, 12, 25), metric: 'impressions', value: 100, integrationId: 'i1' },
        { date: d(2023, 12, 26), metric: 'impressions', value: 200, integrationId: 'i1' },
      ];
      const result = (service as any).buildPrevMap(ss, d(2023, 12, 25), d(2023, 12, 26), 7);
      expect(result.impressions['2024-01-01']).toBe(100);
      expect(result.impressions['2024-01-02']).toBe(200);
    });

    it('returns empty object for empty input', () => {
      expect((service as any).buildPrevMap([], d(2024, 1, 1), d(2024, 1, 1), 0)).toEqual({});
    });

    it('filters out unknown metrics', () => {
      const ss = [{ date: d(2024, 1, 1), metric: 'bogus', value: 100, integrationId: 'i1' }];
      expect((service as any).buildPrevMap(ss, d(2024, 1, 1), d(2024, 1, 1), 0)).toEqual({});
    });
  });

  // ============ PUBLIC METHOD FULL FLOW TESTS ============

  describe('getOverview (full flow)', () => {
    const from = '2024-01-01';
    const to = '2024-01-03';

    it('returns kpis/series/byChannel/breakdown with compare=false', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
        { id: 's3', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 300, date: d(2024, 1, 3), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], false);
      expect(r.kpis[0]).toMatchObject({ metric: 'impressions', total: 600, previousTotal: null, percentageChange: null });
      expect(r.byChannel[0].integrationId).toBe('i1');
      expect(r.breakdown.byPlatform[0]).toMatchObject({ identifier: 'instagram', value: 600 });
    });

    it('returns compare=true with previous snapshots', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 300, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2023, 12, 29) }, { date: d(2023, 12, 30) }, { date: d(2023, 12, 31) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's3', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2023, 12, 30), createdAt: new Date(), integration: {} as any },
        { id: 's4', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 150, date: d(2023, 12, 31), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], true);
      expect(r.kpis[0].total).toBe(500);
      expect(r.kpis[0].previousTotal).toBe(250);
      expect(r.series.impressions[0].previousValue).toBeDefined();
    });

    it('uses live fallback when coverage < threshold', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValue([{ label: 'Impressions', data: [{ date: '2024-01-02', total: 100 }] }]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], false);
      expect(r.kpis[0].metric).toBe('impressions');
    });

    it('handles live fallback error gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('fail'));
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], false);
      expect(r.kpis).toHaveLength(0);
    });

    it('uses live fallback for prev window when compare=true', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ label: 'Impressions', data: [{ date: '2023-12-30', total: 100 }] }]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], true);
      expect(r.kpis[0].previousTotal).not.toBeNull();
    });

    it('handles prev window live fallback error (previousSnapshots is empty, aggregate gives 0)', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('fail'));
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], true);
      expect(r.kpis[0].previousTotal).toBe(0);
      expect(r.kpis[0].total).toBe(200);
    });

    it('handles no known metrics gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'bogus', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], false);
      expect(r.kpis).toHaveLength(0);
    });

    it('handles multiple integrations with multiple metrics', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration, mockIntegration2]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i2', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.getOverview(mockOrg as any, from, to, ['i1', 'i2'], false);
      expect(r.byChannel).toHaveLength(2);
      expect(r.breakdown.byPlatform).toHaveLength(2);
    });
  });

  describe('getOverview (campaign scope, 1.3)', () => {
    const from = '2024-01-01';
    const to = '2024-01-03';

    it('sums only the campaign post snapshots, skips live fallback, sets scope', async () => {
      // The repo returns only campaign A's rows (campaign B shares integration
      // i1 but is filtered out in the repo — see the repository spec).
      (analyticsRepository.getPostSnapshotsByCampaigns as any).mockResolvedValue([
        { id: 'ps1', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date() },
        { id: 'ps2', organizationId: 'org1', postId: 'p2', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date() },
      ]);
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);

      const r = await service.getOverview(mockOrg as any, from, to, [], false, { campaignIds: ['A'] });

      expect(r.scope).toBe('campaign-posts');
      expect(r.kpis[0]).toMatchObject({ metric: 'impressions', total: 300 });
      expect(r.byChannel[0].integrationId).toBe('i1');
      expect(analyticsRepository.getPostSnapshotsByCampaigns).toHaveBeenCalledWith(
        'org1', ['A'], expect.any(Date), expect.any(Date), undefined,
      );
      // Campaign scope must NOT touch channel snapshots / coverage / live fallback.
      expect(analyticsRepository.getSnapshots).not.toHaveBeenCalled();
      expect(analyticsRepository.checkCoverage).not.toHaveBeenCalled();
      expect(integrationService.checkAnalytics).not.toHaveBeenCalled();
    });

    it('differences cumulative post LEVELS against a prior baseline (R1.4)', async () => {
      // One post, cumulative lifetime levels 100→150→220 across the 3-day
      // window, with a prior level of 90 just before it. The KPI total must be
      // the WINDOW DELTA 220−90 = 130 (the old bug summed the in-window rows =
      // 470), and the trend the per-day deltas [10, 50, 70].
      (analyticsRepository.getPostSnapshotsByCampaigns as any).mockResolvedValue([
        { id: 'ps1', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date() },
        { id: 'ps2', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 150, date: d(2024, 1, 2), createdAt: new Date() },
        { id: 'ps3', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 220, date: d(2024, 1, 3), createdAt: new Date() },
      ]);
      (analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 90 },
      ]);
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);

      const r = await service.getOverview(mockOrg as any, from, to, [], false, { campaignIds: ['A'] });

      expect(r.kpis[0]).toMatchObject({ metric: 'impressions', total: 130 });
      expect(r.series.impressions.map((p: any) => p.value)).toEqual([10, 50, 70]);
      expect(r.byChannel[0].kpis[0]).toMatchObject({ total: 130 });
      // baseline was read for the current window (before = window start).
      expect(analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns).toHaveBeenCalledWith(
        'org1', ['A'], expect.any(Date), undefined,
      );
    });

    it('leaves the unscoped overview output unchanged (no scope field)', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);

      const r = await service.getOverview(mockOrg as any, from, to, ['i1'], false);

      expect(r.scope).toBeUndefined();
      expect(r.kpis[0]).toMatchObject({ metric: 'impressions', total: 100 });
      // 6.1 — granularity is a campaign-scope-only label; the org overview
      // series stays unlabeled.
      expect(r.series.impressions[0].granularity).toBeUndefined();
      expect(analyticsRepository.getPostSnapshotsByCampaigns).not.toHaveBeenCalled();
    });

    it('labels each series point daily (≤90d) or weekly (>90d) under campaign scope (6.1)', async () => {
      const oldDay = dayjs().subtract(200, 'day');
      const recentDay = dayjs().subtract(1, 'day');
      (analyticsRepository.getPostSnapshotsByCampaigns as any).mockResolvedValue([
        { id: 'ps1', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 100, date: oldDay.toDate(), createdAt: new Date() },
        { id: 'ps2', organizationId: 'org1', postId: 'p2', integrationId: 'i1', metric: 'impressions', value: 200, date: recentDay.toDate(), createdAt: new Date() },
      ]);
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);

      const r = await service.getOverview(
        mockOrg as any,
        oldDay.format('YYYY-MM-DD'),
        recentDay.format('YYYY-MM-DD'),
        [],
        false,
        { campaignIds: ['A'] },
      );

      const points = r.series.impressions;
      // oldest point (>90d) rides a weekly rollup row; newest (≤90d) is daily.
      expect(points[0].granularity).toBe('weekly');
      expect(points[points.length - 1].granularity).toBe('daily');
    });
  });

  describe('getChannel', () => {
    it('returns overview with channel info', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValueOnce([mockIntegration]).mockResolvedValueOnce([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      const r = await service.getChannel(mockOrg as any, 'i1', '2024-01-01', '2024-01-02', false);
      expect(r.integrationId).toBe('i1');
      expect(r.name).toBe('Test Channel');
      expect(r.identifier).toBe('instagram');
      expect(r.picture).toBe('https://example.com/pic.jpg');
    });

    it('returns empty fields when no integrations found', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      const r = await service.getChannel(mockOrg as any, 'i1', '2024-01-01', '2024-01-02', false);
      expect(r.name).toBe('');
      expect(r.identifier).toBe('');
      expect(r.picture).toBeNull();
    });

    it('returns null picture when integration has none', async () => {
      const intNoPic = { ...mockIntegration, picture: null };
      (analyticsRepository.getIntegrations as any).mockResolvedValueOnce([intNoPic]).mockResolvedValueOnce([intNoPic]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      expect((await service.getChannel(mockOrg as any, 'i1', '2024-01-01', '2024-01-02', false)).picture).toBeNull();
    });
  });

  describe('getPosts', () => {
    const from = '2024-01-01';
    const to = '2024-01-03';
    const mkPost = (id: string, intId = 'i1') => ({
      id, content: `Content ${id}`, publishDate: d(2024, 1, 2),
      organizationId: 'org1', integrationId: intId, deletedAt: null,
      integration: { id: intId, name: 'Channel', providerIdentifier: 'insta', picture: null },
    });

    it('uses the LAST snapshot level per (post, metric) — never the sum of rows', async () => {
      // Post-snapshot values are cumulative lifetime levels; a post snapshotted
      // daily must show its latest level (150), not the row sum (250) which
      // inflates by snapshot-day count and biases sort toward older posts.
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'likes', value: 100, date: d(2024, 1, 1) },
        { postId: 'p1', metric: 'likes', value: 150, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(1);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1']);
      expect(r.posts[0].metrics).toEqual({ likes: 150 });
    });

    it('returns paginated posts with default page/limit', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(1);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1']);
      expect(r.posts).toHaveLength(1);
      expect(r.total).toBe(1);
    });

    it('sorts by known metric desc', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
        { postId: 'p2', metric: 'impressions', value: 300, date: d(2024, 1, 2) },
        { postId: 'p3', metric: 'impressions', value: 200, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1'), mkPost('p2'), mkPost('p3')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(3);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'impressions', 'desc', 1, 25);
      expect(r.posts[0].postId).toBe('p2');
      expect(r.posts[1].postId).toBe('p3');
      expect(r.posts[2].postId).toBe('p1');
    });

    it('sorts by known metric asc', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
        { postId: 'p2', metric: 'impressions', value: 300, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1'), mkPost('p2')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(2);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'impressions', 'asc', 1, 25);
      expect(r.posts[0].postId).toBe('p1');
      expect(r.posts[1].postId).toBe('p2');
    });

    it('uses skip/take when sort is unknown metric', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p3')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(3);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'bogus', undefined, 2, 1);
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].postId).toBe('p3');
    });

    it('returns empty when no posts', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.findPosts as any).mockResolvedValue([]);
      (analyticsRepository.countPosts as any).mockResolvedValue(0);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1']);
      expect(r.posts).toHaveLength(0);
      expect(r.total).toBe(0);
    });

    it('handles null content gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.findPosts as any).mockResolvedValue([{ ...mkPost('p1'), content: null }]);
      (analyticsRepository.countPosts as any).mockResolvedValue(1);
      expect((await service.getPosts(mockOrg as any, from, to, ['i1'])).posts[0].content).toBe('');
    });

    it('paginates sorted results with slice', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
        { postId: 'p2', metric: 'impressions', value: 200, date: d(2024, 1, 2) },
        { postId: 'p3', metric: 'impressions', value: 300, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1'), mkPost('p2'), mkPost('p3')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(3);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'impressions', 'asc', 2, 2);
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].postId).toBe('p3');
    });

    it('returns empty sorted page when slice empty', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(1);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'impressions', 'desc', 2, 25);
      expect(r.posts).toHaveLength(0);
    });

    it('handles empty integrations gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.findPosts as any).mockResolvedValue([]);
      (analyticsRepository.countPosts as any).mockResolvedValue(0);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1']);
      expect(r.posts).toHaveLength(0);
      expect(r.total).toBe(0);
    });

    it('defaults dir to desc when not provided with valid sort', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
        { postId: 'p2', metric: 'impressions', value: 300, date: d(2024, 1, 2) },
      ]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p1'), mkPost('p2')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(2);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], 'impressions');
      expect(r.posts[0].postId).toBe('p2');
    });

    it('supports custom page/limit without sort', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getPostSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.findPosts as any).mockResolvedValue([mkPost('p2')]);
      (analyticsRepository.countPosts as any).mockResolvedValue(3);
      const r = await service.getPosts(mockOrg as any, from, to, ['i1'], undefined, undefined, 2, 1);
      expect(r.posts).toHaveLength(1);
      expect(r.posts[0].postId).toBe('p2');
    });
  });

  describe('getPostDetail', () => {
    const mkPostDetail = (del: Date | null = null, content = 'Hello world') => ({
      id: 'post1', content, publishDate: d(2024, 1, 2),
      integrationId: 'i1', organizationId: 'org1', deletedAt: del,
      integration: { id: 'i1', name: 'Test Channel', providerIdentifier: 'instagram', picture: null },
    });

    it('returns post with metrics grouped by metric', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([
        { postId: 'post1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
        { postId: 'post1', metric: 'impressions', value: 200, date: d(2024, 1, 3) },
        { postId: 'post1', metric: 'likes', value: 10, date: d(2024, 1, 2) },
      ]);
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.postId).toBe('post1');
      expect(r.metrics.impressions).toHaveLength(2);
      expect(r.metrics.likes).toHaveLength(1);
    });

    it('throws NotFoundException when post not found', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(null);
      await expect(service.getPostDetail(mockOrg as any, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('returns empty metrics when no snapshots', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      expect((await service.getPostDetail(mockOrg as any, 'post1')).metrics).toEqual({});
    });

    it('returns integration info', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.integration.name).toBe('Test Channel');
      expect(r.integration.identifier).toBe('instagram');
    });

    it('returns snapshots directly without calling live fallback', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([
        { postId: 'post1', metric: 'impressions', value: 100, date: d(2024, 1, 2) },
      ]);
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.metrics.impressions).toHaveLength(1);
      expect(postsService.checkPostAnalytics).not.toHaveBeenCalled();
    });

    it('calls live fallback when snapshots empty and converts live data', async () => {
      const recentDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      (postsService.checkPostAnalytics as any).mockResolvedValue([
        { label: 'Likes', data: [{ total: '50', date: recentDate }] },
      ]);
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(postsService.checkPostAnalytics).toHaveBeenCalledWith('org1', 'post1', 30);
      expect(r.metrics.likes).toBeDefined();
      expect(r.metrics.likes[0].value).toBe(50);
    });

    it('handles empty snapshots with failing live fallback gracefully', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      (postsService.checkPostAnalytics as any).mockRejectedValue(new Error('API down'));
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.metrics).toEqual({});
    });

    it('handles live fallback returning missing gracefully', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      (postsService.checkPostAnalytics as any).mockResolvedValue({ missing: true });
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.metrics).toEqual({});
    });

    it('handles live fallback returning non-array gracefully', async () => {
      (analyticsRepository.findPost as any).mockResolvedValue(mkPostDetail());
      (analyticsRepository.getPostDetailSnapshots as any).mockResolvedValue([]);
      (postsService.checkPostAnalytics as any).mockResolvedValue(undefined);
      const r = await service.getPostDetail(mockOrg as any, 'post1');
      expect(r.metrics).toEqual({});
    });
  });

  describe('getMetricDetail', () => {
    const from = '2024-01-01';
    const to = '2024-01-03';

    it('returns metric detail with compare=false', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false);
      expect(r.metric).toBe('impressions');
      expect(r.total).toBe(300);
      expect(r.previousTotal).toBeNull();
      expect(r.series).toHaveLength(3);
      expect(r.movers).toEqual({ up: [], down: [] });
    });

    it('campaign scope: total is the window delta of post LEVELS, matching the overview KPI (R1.5)', async () => {
      // Same fixture as the overview R1.4 test: cumulative levels 100→150→220
      // with a prior baseline of 90 ⇒ total 130, series [10,50,70].
      (analyticsRepository.getPostSnapshotsByCampaigns as any).mockResolvedValue([
        { id: 'ps1', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date() },
        { id: 'ps2', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 150, date: d(2024, 1, 2), createdAt: new Date() },
        { id: 'ps3', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 220, date: d(2024, 1, 3), createdAt: new Date() },
      ]);
      (analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns as any).mockResolvedValue([
        { postId: 'p1', metric: 'impressions', value: 90 },
      ]);
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);

      const r = await service.getMetricDetail(
        mockOrg as any, 'impressions', from, to, [], false, { campaignIds: ['A'] }
      );

      expect(r.total).toBe(130);
      expect(r.series.map((p: any) => p.value)).toEqual([10, 50, 70]);
      expect(r.byChannel[0].value).toBe(130);
      // no live fallback under campaign scope
      expect(integrationService.checkAnalytics).not.toHaveBeenCalled();
    });

    it('campaign scope: previous window uses the explicit filter (or none), not the derived channel set (R1.6)', async () => {
      // No explicit integration filter passed. Current window derives channels
      // from its own snapshots; the previous window must still pass `undefined`
      // so a channel that only posted in the prior window is included.
      (analyticsRepository.getPostSnapshotsByCampaigns as any)
        .mockResolvedValueOnce([
          { id: 'ps1', organizationId: 'org1', postId: 'p1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 3), createdAt: new Date() },
        ])
        .mockResolvedValueOnce([
          { id: 'ps2', organizationId: 'org1', postId: 'p2', integrationId: 'i2', metric: 'impressions', value: 80, date: d(2023, 12, 30), createdAt: new Date() },
        ]);
      (analyticsRepository.getLatestPostSnapshotsBeforeByCampaigns as any).mockResolvedValue([]);
      // No explicit filter → getIntegrations([]) returns [] (Prisma `in: []`);
      // the derived-channel lookup then resolves the campaign's channels.
      (analyticsRepository.getIntegrations as any)
        .mockResolvedValueOnce([])
        .mockResolvedValue([mockIntegration]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);

      await service.getMetricDetail(
        mockOrg as any, 'impressions', from, to, [], true, { campaignIds: ['A'] }
      );

      const calls = (analyticsRepository.getPostSnapshotsByCampaigns as any).mock.calls;
      // current window (call 0) and previous window (call 1) both pass the
      // explicit filter — here `undefined` — as the 5th arg.
      expect(calls[0][4]).toBeUndefined();
      expect(calls[1][4]).toBeUndefined();
    });

    it('returns with compare=true and movers (up)', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2023, 12, 29) }, { date: d(2023, 12, 30) }, { date: d(2023, 12, 31) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's3', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 50, date: d(2023, 12, 30), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], true);
      expect(r.previousTotal).not.toBeNull();
      expect(r.series[0]).toHaveProperty('previousValue');
      expect(r.movers.up).toHaveLength(1);
      expect(r.movers.down).toHaveLength(0);
    });

    it('populates movers.down with negative changes', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 50, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2023, 12, 29) }, { date: d(2023, 12, 30) }, { date: d(2023, 12, 31) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's3', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2023, 12, 30), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], true);
      expect(r.movers.up).toHaveLength(0);
      expect(r.movers.down).toHaveLength(1);
    });

    it('throws NotFoundException for unknown metric', async () => {
      await expect(service.getMetricDetail(mockOrg as any, 'bogus', from, to, ['i1'], false)).rejects.toThrow(NotFoundException);
    });

    it('includes topPosts', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([
        { postId: 'p1', value: 50, integrationId: 'i1', metric: 'impressions', post: { content: 'Top post', publishDate: d(2024, 1, 2) } },
      ]);
      expect((await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false)).topPosts).toHaveLength(1);
    });

    it('uses live fallback when coverage < threshold', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValue([{ label: 'Impressions', data: [{ date: '2024-01-02', total: 100 }] }]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      expect((await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false)).total).toBe(100);
    });

    it('uses live fallback for prev window with compare=true', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ label: 'Impressions', data: [{ date: '2023-12-30', total: 100 }] }]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], true);
      expect(r.previousTotal).not.toBeNull();
    });

    it('handles empty topPosts gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      expect((await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false)).topPosts).toEqual([]);
    });

    it('handles no integrations gracefully', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      expect((await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false)).byChannel).toHaveLength(0);
    });

    it('handles stock metric kind', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'followers', value: 1000, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'followers', value: 1100, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      expect((await service.getMetricDetail(mockOrg as any, 'followers', from, to, ['i1'], false)).total).toBe(1100);
    });

    it('returns zero series when no snapshots for metric', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1'], false);
      expect(r.total).toBe(0);
      expect(r.series.every((s: any) => s.value === 0)).toBe(true);
    });

    it('handles multiple integrations in byChannel', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration, mockIntegration2]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i2', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getMetricDetailTopPosts as any).mockResolvedValue([]);
      const r = await service.getMetricDetail(mockOrg as any, 'impressions', from, to, ['i1', 'i2'], false);
      expect(r.byChannel).toHaveLength(2);
      expect(r.byChannel[0].share + r.byChannel[1].share).toBe(100);
    });
  });

  describe('getDayDetail', () => {
    it('returns byChannel and posts for known metric', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getDayAnalyticsSnapshots as any).mockResolvedValue([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getDayPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', value: 50, integrationId: 'i1', metric: 'impressions', post: { content: 'Hello', publishDate: d(2024, 1, 2) } },
      ]);
      const r = await service.getDayDetail(mockOrg as any, '2024-01-02', 'impressions', ['i1']);
      expect(r.value).toBe(100);
      expect(r.byChannel).toHaveLength(1);
      expect(r.posts).toHaveLength(1);
    });

    it('throws NotFoundException for unknown metric', async () => {
      await expect(service.getDayDetail(mockOrg as any, '2024-01-02', 'bogus', ['i1'])).rejects.toThrow(NotFoundException);
    });

    it('returns zero values when no snapshots', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getDayAnalyticsSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.getDayPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getDayDetail(mockOrg as any, '2024-01-02', 'impressions', ['i1']);
      expect(r.value).toBe(0);
      expect(r.byChannel[0].value).toBe(0);
      expect(r.posts).toHaveLength(0);
    });

    it('handles multiple integrations', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration, mockIntegration2]);
      (analyticsRepository.getDayAnalyticsSnapshots as any).mockResolvedValue([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i2', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getDayPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getDayDetail(mockOrg as any, '2024-01-02', 'impressions', ['i1', 'i2']);
      expect(r.value).toBe(300);
      expect(r.byChannel).toHaveLength(2);
    });

    it('includes integration info in posts', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getDayAnalyticsSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.getDayPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', value: 50, integrationId: 'i1', metric: 'impressions', post: { content: 'Hello', publishDate: d(2024, 1, 2) } },
      ]);
      const r = await service.getDayDetail(mockOrg as any, '2024-01-02', 'impressions', ['i1']);
      expect(r.posts[0].integration?.name).toBe('Test Channel');
    });

    it('handles post with no matching integration', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      (analyticsRepository.getDayAnalyticsSnapshots as any).mockResolvedValue([]);
      (analyticsRepository.getDayPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', value: 50, integrationId: 'i1', metric: 'impressions', post: { content: 'Hello', publishDate: d(2024, 1, 2) } },
      ]);
      expect((await service.getDayDetail(mockOrg as any, '2024-01-02', 'impressions', ['i1'])).posts[0].integration).toBeNull();
    });
  });

  describe('getChannelMetric', () => {
    const from = '2024-01-01';
    const to = '2024-01-03';

    it('returns series with previousValue when compare=true', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2023, 12, 29) }, { date: d(2023, 12, 30) }, { date: d(2023, 12, 31) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([
        { id: 's3', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 50, date: d(2023, 12, 30), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, true);
      expect(r.series[0]).toHaveProperty('previousValue');
      expect(r.byDay).toHaveLength(1);
    });

    it('returns series without previousValue when compare=false', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false);
      expect(r.series[0]).not.toHaveProperty('previousValue');
    });

    it('throws NotFoundException when integration not found', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      await expect(service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for unknown metric', async () => {
      await expect(service.getChannelMetric(mockOrg as any, 'i1', 'bogus', from, to, false)).rejects.toThrow(NotFoundException);
    });

    it('returns topPosts', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([
        { postId: 'p1', value: 50, integrationId: 'i1', metric: 'impressions', post: { content: 'Hello', publishDate: d(2024, 1, 2) } },
      ]);
      expect((await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false)).topPosts).toHaveLength(1);
    });

    it('handles live fallback when coverage < threshold', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValue([{ label: 'Impressions', data: [{ date: '2024-01-02', total: 100 }] }]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      expect((await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false)).series[1].value).toBe(100);
    });

    it('handles live fallback error', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('fail'));
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false);
      expect(r.series.every((s: any) => s.value === 0)).toBe(true);
    });

    it('handles live fallback for prev window with compare=true', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ label: 'Impressions', data: [{ date: '2023-12-30', total: 100 }] }]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, true);
      expect(r.series[0].previousValue).toBe(0);
    });

    it('handles compare=true live fallback error', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([{ id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any }]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('fail'));
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, true);
      expect(r.series[0]).toHaveProperty('previousValue');
    });

    it('returns empty series when no snapshots', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }, { date: d(2024, 1, 3) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false);
      expect(r.series.every((s: any) => s.value === 0)).toBe(true);
      expect(r.byDay).toHaveLength(0);
    });

    it('returns byDay totals', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }]);
      (analyticsRepository.getChannelAnalyticsSnapshots as any).mockResolvedValueOnce([
          { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
          { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
        ]);
      (analyticsRepository.getChannelPostSnapshots as any).mockResolvedValue([]);
      const r = await service.getChannelMetric(mockOrg as any, 'i1', 'impressions', from, to, false);
      expect(r.byDay).toHaveLength(2);
      expect(r.byDay[0]).toMatchObject({ date: '2024-01-01', value: 100 });
      expect(r.byDay[1]).toMatchObject({ date: '2024-01-02', value: 200 });
    });
  });

  describe('exportData', () => {
    it('returns CSV with header and rows', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 200, date: d(2024, 1, 2), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.exportData(mockOrg as any, '2024-01-01', '2024-01-02', ['i1'], 'csv');
      expect(r.contentType).toBe('text/csv');
      expect(r.data).toContain('metric,label,format,total,percentage_change,date,value');
      expect(r.data).toContain('impressions');
    });

    it('returns JSON format', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.exportData(mockOrg as any, '2024-01-01', '2024-01-01', ['i1'], 'json');
      expect(r.contentType).toBe('application/json');
      const parsed = JSON.parse(r.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].metric).toBe('impressions');
    });

    it('exports with compare=true', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }, { date: d(2024, 1, 2) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2023, 12, 31) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's2', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 50, date: d(2023, 12, 31), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.exportData(mockOrg as any, '2024-01-01', '2024-01-02', ['i1'], 'json', true);
      const parsed = JSON.parse(r.data);
      expect(parsed).toHaveLength(2);
    });

    it('handles null percentageChange in CSV', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.checkCoverage as any).mockResolvedValueOnce([{ date: d(2024, 1, 1) }]);
      (analyticsRepository.getSnapshots as any).mockResolvedValueOnce([
        { id: 's1', organizationId: 'org1', integrationId: 'i1', metric: 'impressions', value: 100, date: d(2024, 1, 1), createdAt: new Date(), integration: {} as any },
      ]);
      const r = await service.exportData(mockOrg as any, '2024-01-01', '2024-01-01', ['i1'], 'csv');
      expect(r.data).toContain(',,');
    });
  });

  // ── L5: Short-link pass-through methods ──

  describe('getLinksForOrg', () => {
    it('delegates to OrgShortLinkSettingsService.getLinksForOrg', async () => {
      const mockLinks = [{ id: 'l1', shortUrl: 'https://sh.rt/a' }];
      (shortLinkSettingsService.getLinksForOrg as any).mockResolvedValue(mockLinks);
      const result = await service.getLinksForOrg('org1');
      expect(shortLinkSettingsService.getLinksForOrg).toHaveBeenCalledWith('org1');
      expect(result).toEqual(mockLinks);
    });
  });

  describe('getAggregatedClicks', () => {
    it('delegates to OrgShortLinkSettingsService.getAggregatedClicks', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-07');
      const mockClicks = [{ shortLinkId: 'l1', clicks: 42 }];
      (shortLinkSettingsService.getAggregatedClicks as any).mockResolvedValue(mockClicks);
      const result = await service.getAggregatedClicks('org1', from, to);
      expect(shortLinkSettingsService.getAggregatedClicks).toHaveBeenCalledWith('org1', from, to);
      expect(result).toEqual(mockClicks);
    });
  });

  describe('getShortLinks', () => {
    it('aggregates clicks per link and returns enriched link rows', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-07');
      (shortLinkSettingsService.getLinksForOrg as any).mockResolvedValue([
        { id: 'l1', shortUrl: 'https://sh.rt/a', originalUrl: 'https://example.com/a', provider: 'bitly', createdAt: new Date('2024-01-01') },
        { id: 'l2', shortUrl: 'https://sh.rt/b', originalUrl: 'https://example.com/b', provider: 'bitly', createdAt: new Date('2024-01-02') },
      ]);
      (shortLinkSettingsService.getAggregatedClicks as any).mockResolvedValue([
        { shortLinkId: 'l1', clicks: 42, date: new Date('2024-01-03T12:00:00.000Z') },
        { shortLinkId: 'l1', clicks: 8, date: new Date('2024-01-04T12:00:00.000Z') },
        { shortLinkId: 'l2', clicks: 7, date: new Date('2024-01-05T12:00:00.000Z') },
      ]);

      const result = await service.getShortLinks('org1', from, to);

      expect(shortLinkSettingsService.getLinksForOrg).toHaveBeenCalledWith('org1');
      expect(shortLinkSettingsService.getAggregatedClicks).toHaveBeenCalledWith('org1', from, to);
      expect(result).toHaveLength(2);
      expect(result[0].clicks).toBe(50);
      expect(result[1].clicks).toBe(7);
    });

    it('returns zero clicks for links with no snapshots', async () => {
      (shortLinkSettingsService.getLinksForOrg as any).mockResolvedValue([
        { id: 'l1', shortUrl: 'https://sh.rt/a', originalUrl: 'https://example.com/a', provider: 'bitly', createdAt: new Date() },
      ]);
      (shortLinkSettingsService.getAggregatedClicks as any).mockResolvedValue([]);

      const result = await service.getShortLinks('org1', new Date('2024-01-01'), new Date('2024-01-07'));

      expect(result[0].clicks).toBe(0);
    });
  });

  describe('getShortLinkTimeseries', () => {
    it('aggregates clicks by date and returns a sorted daily series', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-07');
      (shortLinkSettingsService.getAggregatedClicks as any).mockResolvedValue([
        { date: new Date('2024-01-01T12:00:00.000Z'), clicks: 10 },
        { date: new Date('2024-01-01T12:00:00.000Z'), clicks: 5 },
        { date: new Date('2024-01-02T12:00:00.000Z'), clicks: 15 },
      ]);

      const result = await service.getShortLinkTimeseries('org1', from, to);

      expect(shortLinkSettingsService.getAggregatedClicks).toHaveBeenCalledWith('org1', from, to);
      expect(result).toEqual([
        { date: '2024-01-01', clicks: 15 },
        { date: '2024-01-02', clicks: 15 },
      ]);
    });

    it('returns empty array when no snapshots exist', async () => {
      (shortLinkSettingsService.getAggregatedClicks as any).mockResolvedValue([]);

      const result = await service.getShortLinkTimeseries('org1', new Date('2024-01-01'), new Date('2024-01-07'));

      expect(result).toEqual([]);
    });
  });

  describe('getRecommendations (0.1 — real previous-window baseline)', () => {
    const seedCurrent = (impressions: number) => {
      (analyticsRepository.getBestTimeIntegrations as any).mockResolvedValue([
        { id: 'i1', name: 'IG', providerIdentifier: 'instagram', picture: null },
      ]);
      (analyticsRepository.getSnapshots as any).mockResolvedValue([
        { integrationId: 'i1', metric: 'impressions', value: impressions, date: d(2024, 6, 1) },
      ]);
    };

    it('fires "underperforming" when current is well below the real prior window', async () => {
      seedCurrent(500);
      (analyticsRepository.sumFlowMetric as any).mockResolvedValue({ i1: 1000 }); // 500 < 1000*0.75
      const { recommendations: recs } = await service.getRecommendations(mockOrg as any);
      expect(recs.some((r: any) => r.type === 'underperforming')).toBe(true);
    });

    it('does NOT fire when current ≈ prior window (no real decline)', async () => {
      seedCurrent(500);
      (analyticsRepository.sumFlowMetric as any).mockResolvedValue({ i1: 500 }); // 500 !< 375
      const { recommendations: recs } = await service.getRecommendations(mockOrg as any);
      expect(recs.some((r: any) => r.type === 'underperforming')).toBe(false);
    });

    it('does NOT fire when the prior window is empty/below floor (no *0.7 fabrication)', async () => {
      seedCurrent(500);
      (analyticsRepository.sumFlowMetric as any).mockResolvedValue({}); // prev 0 < 100 floor
      const { recommendations: recs } = await service.getRecommendations(mockOrg as any);
      expect(recs.some((r: any) => r.type === 'underperforming')).toBe(false);
    });
  });

  // ── 6.2: engagement-rate derived metrics (pure math) ──
  describe('computeDerivedMetrics (6.2)', () => {
    const snap = (metric: string, value: number) => ({
      integrationId: 'i1', metric, value, date: d(2024, 1, 1),
    });

    it('computes engagement rate = (likes+comments+shares)/impressions', () => {
      const r = computeDerivedMetrics([
        snap('impressions', 1000),
        snap('likes', 50),
        snap('comments', 30),
        snap('shares', 20),
      ]);
      expect(r.engagementRate).toBeCloseTo(0.1); // 100/1000
    });

    it('computes reach-per-follower = reach/followers', () => {
      const r = computeDerivedMetrics([
        snap('reach', 2000),
        snap('followers', 500),
      ]);
      expect(r.reachPerFollower).toBeCloseTo(4); // 2000/500
    });

    it('returns null (NOT 0) for engagement rate when impressions are 0/missing', () => {
      const r = computeDerivedMetrics([snap('likes', 50)]);
      expect(r.engagementRate).toBeNull();
    });

    it('returns null (NOT 0) for reach-per-follower when followers are 0/missing', () => {
      const r = computeDerivedMetrics([snap('reach', 2000)]);
      expect(r.reachPerFollower).toBeNull();
    });

    it('empty input → both null', () => {
      expect(computeDerivedMetrics([])).toEqual({ engagementRate: null, reachPerFollower: null });
    });

    it('surfaces derived on the overview response (org-wide + per-channel)', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getSnapshots as any).mockResolvedValue([
        { integrationId: 'i1', metric: 'impressions', value: 1000, date: d(2024, 1, 1) },
        { integrationId: 'i1', metric: 'likes', value: 100, date: d(2024, 1, 1) },
      ]);
      const r = await service.getOverview(mockOrg as any, '2024-01-01', '2024-01-02', ['i1'], false);
      expect(r.derived).toBeDefined();
      expect(r.derived!.engagementRate).toBeCloseTo(0.1);
      expect(r.byChannel[0].derived).toBeDefined();
      expect(r.byChannel[0].derived!.engagementRate).toBeCloseTo(0.1);
    });
  });

  // ── 6.4: best-time v2 (tz + confidence) ──
  describe('getBestTimeData (6.4)', () => {
    const seedPost = (isoUtc: string) => ({
      id: 'p' + isoUtc, publishDate: new Date(isoUtc), integrationId: 'i1',
      lastViews: 10, lastLikes: 0, lastComments: 0,
    });

    beforeEach(() => {
      (analyticsRepository.getBestTimeIntegrations as any).mockResolvedValue([
        { id: 'i1', name: 'IG', providerIdentifier: 'instagram', picture: null },
      ]);
      (analyticsRepository.getBestTimeSnapshots as any).mockResolvedValue([]);
    });

    it('tz shifts the bucket by the zone offset vs UTC', async () => {
      // 2024-01-02T02:00Z → in America/New_York (UTC-5) that is 2024-01-01 21:00
      (analyticsRepository.getBestTimePosts as any).mockResolvedValue([
        seedPost('2024-01-02T02:00:00.000Z'),
      ]);

      const utcRes = await service.getBestTimeData('org1', ['i1'], 'UTC');
      const nyRes = await service.getBestTimeData('org1', ['i1'], 'America/New_York');

      const utcSlot = utcRes.heatmap.find((h) => h.postCount > 0)!;
      const nySlot = nyRes.heatmap.find((h) => h.postCount > 0)!;

      expect(utcSlot.hour).toBe(2);
      expect(nySlot.hour).toBe(21); // shifted back 5 hours
      expect(nySlot.day).not.toBe(utcSlot.day); // crossed midnight → prev day
    });

    it('flags low-sample slots with a confidence tier', async () => {
      (analyticsRepository.getBestTimePosts as any).mockResolvedValue([
        seedPost('2024-01-02T02:00:00.000Z'), // 1 post at that slot → low
      ]);
      const res = await service.getBestTimeData('org1', ['i1'], 'UTC');
      const slot = res.heatmap.find((h) => h.postCount === 1)!;
      expect(slot.confidence).toBe('low');
      const empty = res.heatmap.find((h) => h.postCount === 0)!;
      expect(empty.confidence).toBe('none');
    });

    it('bestTimeConfidence thresholds', () => {
      expect(bestTimeConfidence(0)).toBe('none');
      expect(bestTimeConfidence(1)).toBe('low');
      expect(bestTimeConfidence(4)).toBe('medium');
      expect(bestTimeConfidence(10)).toBe('high');
    });
  });

  // ── 6.6: data-health panel ──
  describe('getDataHealth (6.6)', () => {
    it('labels unsupported providers and flags stale/coverage', async () => {
      (analyticsRepository.getBestTimeIntegrations as any).mockResolvedValue([
        { id: 'i1', name: 'IG', providerIdentifier: 'instagram', picture: null }, // supports analytics
        { id: 'i2', name: 'Disc', providerIdentifier: 'discord', picture: null }, // no analytics
      ]);
      // i1 has 4 distinct covered days in the 7-day window
      (analyticsRepository.checkCoverage as any).mockResolvedValue([
        { integrationId: 'i1', date: d(2024, 1, 1) },
        { integrationId: 'i1', date: d(2024, 1, 2) },
        { integrationId: 'i1', date: d(2024, 1, 3) },
        { integrationId: 'i1', date: d(2024, 1, 4) },
      ]);
      // i1's last snapshot is old → stale
      (analyticsRepository.getLastSnapshotDates as any).mockResolvedValue([
        { integrationId: 'i1', date: d(2020, 1, 1) },
      ]);

      const rows = await service.getDataHealth(mockOrg as any);
      const i1 = rows.find((r) => r.integrationId === 'i1')!;
      const i2 = rows.find((r) => r.integrationId === 'i2')!;

      expect(i1.supportsAnalytics).toBe(true);
      expect(i1.coverage).toBeCloseTo(4 / 7);
      expect(i1.stale).toBe(true);
      // unsupported channel is labeled, not zeroed as "broken"
      expect(i2.supportsAnalytics).toBe(false);
      expect(i2.coverage).toBe(0);
      expect(i2.stale).toBe(false);
      expect(i2.lastSnapshotDate).toBeNull();
    });

    it('empty org → empty array', async () => {
      (analyticsRepository.getBestTimeIntegrations as any).mockResolvedValue([]);
      expect(await service.getDataHealth(mockOrg as any)).toEqual([]);
    });
  });

  // ── 6.7: on-demand channel refresh ──
  describe('refreshChannel (6.7)', () => {
    it('persists the returned series via upsertChannelSnapshot', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (integrationService.checkAnalytics as any).mockResolvedValue([
        { label: 'Likes', data: [{ date: dayjs().format('YYYY-MM-DD'), total: 42 }] },
      ]);

      const result = await service.refreshChannel(mockOrg as any, 'i1');

      expect(integrationService.checkAnalytics).toHaveBeenCalled();
      expect(analyticsRepository.upsertChannelSnapshot).toHaveBeenCalledTimes(1);
      expect((analyticsRepository.upsertChannelSnapshot as any).mock.calls[0][0]).toMatchObject({
        integrationId: 'i1', metric: 'likes', value: 42,
      });
      expect(result.persisted).toBe(1);
    });

    it('404s an unknown integration', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      await expect(service.refreshChannel(mockOrg as any, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('surfaces provider errors as a 502 (never swallowed)', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (integrationService.checkAnalytics as any).mockRejectedValue(new Error('provider down'));
      await expect(service.refreshChannel(mockOrg as any, 'i1')).rejects.toMatchObject({ status: 502 });
    });
  });

  // ── 7.4: content-attribute intelligence (pure fn + service) ──
  describe('computeContentInsights (7.4)', () => {
    const post = (over: Partial<{ image: string | null; content: string; campaignId: string | null; publishDate: Date; engagement: number }>) => ({
      image: null, content: '', campaignId: null, publishDate: d(2024, 1, 1), engagement: 0, ...over,
    });

    it('surfaces a bucket that outperforms the org mean with ≥5 samples', () => {
      const posts = [
        // 5 video posts averaging 1000 engagement
        ...Array.from({ length: 5 }, () => post({ image: JSON.stringify([{ path: 'a.mp4' }]), engagement: 1000 })),
        // 5 image posts averaging 100 engagement
        ...Array.from({ length: 5 }, () => post({ image: JSON.stringify([{ path: 'a.jpg' }]), engagement: 100 })),
      ];
      const { findings } = computeContentInsights(posts);
      const video = findings.find((f) => f.dimension === 'media' && f.bucket === 'video');
      expect(video).toBeDefined();
      expect(video!.direction).toBe('up');
      expect(video!.sampleSize).toBe(5);
      expect(video!.ratio).toBeGreaterThan(1);
    });

    it('suppresses under-sampled buckets (<5)', () => {
      const posts = [
        ...Array.from({ length: 3 }, () => post({ image: JSON.stringify([{ path: 'a.mp4' }]), engagement: 5000 })),
        ...Array.from({ length: 6 }, () => post({ image: JSON.stringify([{ path: 'a.jpg' }]), engagement: 100 })),
      ];
      const { findings } = computeContentInsights(posts);
      expect(findings.some((f) => f.bucket === 'video')).toBe(false); // only 3 samples
    });

    it('zero posts → empty findings', () => {
      expect(computeContentInsights([])).toEqual({ findings: [], totalPosts: 0, orgMean: 0 });
    });

    it('parses Post.image defensively (malformed JSON → no media, no throw)', () => {
      const posts = Array.from({ length: 5 }, () => post({ image: 'not-json{', engagement: 500 }));
      const { findings, totalPosts } = computeContentInsights(posts);
      expect(totalPosts).toBe(5);
      // all fall in the "none" media bucket; no crash
      expect(findings.every((f) => f.bucket !== 'video')).toBe(true);
    });

    it('service delegates to the repo + pure fn', async () => {
      (analyticsRepository.getContentInsightPosts as any).mockResolvedValue([
        { id: 'p1', content: 'hi', image: null, campaignId: null, publishDate: d(2024, 1, 1), lastViews: 5, lastLikes: 5, lastComments: 0 },
      ]);
      const r = await service.getContentInsights(mockOrg as any);
      expect(analyticsRepository.getContentInsightPosts).toHaveBeenCalled();
      expect(r.totalPosts).toBe(1);
      expect(r.orgMean).toBe(10);
    });
  });

  // ── 7.5: LLM-narrated summary (no-provider rule + stubbed model) ──
  describe('narrate (7.5)', () => {
    it('AI-off org → standard "AI not configured" error, no generateText call', async () => {
      aiModelProvider.resolveConfigForScope.mockResolvedValue(null);
      await expect(service.narrate(mockOrg as any, '2024-01-01', '2024-01-07'))
        .rejects.toThrow(/AI is not configured/);
      expect(aiModelProvider.generateText).not.toHaveBeenCalled();
    });

    it('with an active provider, assembles context and returns the narrative', async () => {
      aiModelProvider.resolveConfigForScope.mockResolvedValue({ providerId: 'openai' });
      aiModelProvider.generateText.mockResolvedValue('Your impressions grew.');
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository.getSnapshots as any).mockResolvedValue([
        { integrationId: 'i1', metric: 'impressions', value: 1000, date: d(2024, 1, 1) },
      ]);
      (analyticsRepository.getContentInsightPosts as any).mockResolvedValue([]);
      (analyticsRepository.listAnomalies as any).mockResolvedValue([]);

      const r = await service.narrate(mockOrg as any, '2024-01-01', '2024-01-07');
      expect(aiModelProvider.generateText).toHaveBeenCalledWith(
        'utility', expect.any(String), expect.objectContaining({ orgId: 'org1' }),
      );
      expect(r.narrative).toBe('Your impressions grew.');
    });
  });

  // R2.5 — a provided alert-rule integrationId must belong to the org.
  describe('alert-rule integrationId org-ownership (R2.5)', () => {
    const UUID = '11111111-1111-4111-8111-111111111111';

    it('createAlertRule throws 400 when integrationId is not the org\'s channel', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      (analyticsRepository as any).createAlertRule = vi.fn();

      await expect(
        service.createAlertRule('org1', {
          integrationId: UUID,
          metric: 'followers',
          comparator: 'gte',
          threshold: 100,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(analyticsRepository.getIntegrations).toHaveBeenCalledWith('org1', [UUID]);
      expect((analyticsRepository as any).createAlertRule).not.toHaveBeenCalled();
    });

    it('createAlertRule persists when the integrationId belongs to the org', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([mockIntegration]);
      (analyticsRepository as any).createAlertRule = vi.fn().mockResolvedValue({ id: 'r1' });

      const res = await service.createAlertRule('org1', {
        integrationId: mockIntegration.id,
        metric: 'followers',
        comparator: 'gte',
        threshold: 100,
      });
      expect(res).toEqual({ id: 'r1' });
      expect((analyticsRepository as any).createAlertRule).toHaveBeenCalledOnce();
    });

    it('createAlertRule skips the ownership check when no integrationId is given', async () => {
      (analyticsRepository as any).createAlertRule = vi.fn().mockResolvedValue({ id: 'r2' });
      const spy = analyticsRepository.getIntegrations as any;

      await service.createAlertRule('org1', {
        metric: 'followers',
        comparator: 'gte',
        threshold: 100,
      });
      expect(spy).not.toHaveBeenCalled();
      expect((analyticsRepository as any).createAlertRule).toHaveBeenCalledOnce();
    });

    it('updateAlertRule throws 400 for a foreign integrationId before touching the row', async () => {
      (analyticsRepository.getIntegrations as any).mockResolvedValue([]);
      (analyticsRepository as any).updateAlertRule = vi.fn();

      await expect(
        service.updateAlertRule('org1', 'r1', { integrationId: UUID }),
      ).rejects.toThrow(BadRequestException);
      expect((analyticsRepository as any).updateAlertRule).not.toHaveBeenCalled();
    });
  });
});
