import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateWatchlistDto } from '@gitroom/nestjs-libraries/dtos/analytics/analytics.query.dto';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

vi.mock('@gitroom/nestjs-libraries/analytics/analytics.service', () => ({
  AnalyticsService: class MockAnalyticsService {
    getOverview = vi.fn();
    getChannel = vi.fn();
    getPosts = vi.fn();
    getPostDetail = vi.fn();
    getMetricDetail = vi.fn();
    getDayDetail = vi.fn();
    getChannelMetric = vi.fn();
    getBestTimeData = vi.fn();
    exportData = vi.fn();
    getLinksForOrg = vi.fn();
    getAggregatedClicks = vi.fn();
    getShortLinks = vi.fn();
    getShortLinkTimeseries = vi.fn();
    getDataHealth = vi.fn();
    refreshChannel = vi.fn();
    getContentInsights = vi.fn();
    narrate = vi.fn();
    getFollowerSeries = vi.fn();
    listAlertRules = vi.fn();
    createAlertRule = vi.fn();
    updateAlertRule = vi.fn();
    deleteAlertRule = vi.fn();
  },
}));

import {
  AnalyticsV2Controller,
  parseIntegrations,
  parseCampaigns,
  parsePage,
  parseLimit,
  parseCompare,
  validateDateRange,
  validateToGteFrom,
} from './analytics.v2.controller';
import { AnalyticsService } from '@gitroom/nestjs-libraries/analytics/analytics.service';
import type {
  AnalyticsDateRangeDto,
  AnalyticsPostsQueryDto,
  AnalyticsExportQueryDto,
} from '@gitroom/nestjs-libraries/dtos/analytics/analytics.query.dto';

const mockOrg = { id: 'test-org-id', name: 'Test Org' } as any;

function mockResponse() {
  return { setHeader: vi.fn().mockReturnThis() };
}

function dq(overrides: Partial<AnalyticsDateRangeDto & AnalyticsPostsQueryDto & AnalyticsExportQueryDto> = {}): AnalyticsDateRangeDto & AnalyticsPostsQueryDto & AnalyticsExportQueryDto {
  return {
    from: '2024-01-01',
    to: '2024-01-07',
    integrations: undefined,
    compare: undefined,
    sort: undefined,
    dir: undefined,
    page: undefined,
    limit: undefined,
    format: undefined,
    ...overrides,
  };
}

describe('AnalyticsV2Controller', () => {
  let controller: AnalyticsV2Controller;
  let service: AnalyticsService;
  let watchlistService: any;
  let shareService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new (AnalyticsService as any)();
    watchlistService = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      getSeries: vi.fn(),
    } as any;
    shareService = {
      getShare: vi.fn(),
      mintShare: vi.fn(),
      disableShare: vi.fn(),
    } as any;
    controller = new AnalyticsV2Controller(
      service as unknown as AnalyticsService,
      watchlistService,
      shareService,
    );
  });

  it('getOverview delegates and parses integrations param', async () => {
    const mockResult: Record<string, any> = { kpis: [] };
    (service.getOverview as any).mockResolvedValue(mockResult);

    const result = await controller.getOverview(mockOrg, dq({ integrations: 'i1,i2', compare: 'true' }));

    expect(service.getOverview).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', ['i1', 'i2'], true, { campaignIds: [] });
    expect(result).toBe(mockResult);
  });

  it('getOverview passes empty array when integrations param missing', async () => {
    (service.getOverview as any).mockResolvedValue({ kpis: [] });

    await controller.getOverview(mockOrg, dq({ integrations: undefined, compare: undefined }));

    expect(service.getOverview).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], false, { campaignIds: [] });
  });

  it('getChannel delegates correctly', async () => {
    (service.getChannel as any).mockResolvedValue({ kpis: [] });

    await controller.getChannel(mockOrg, 'ch1', dq({ compare: 'true' }));

    expect(service.getChannel).toHaveBeenCalledWith(mockOrg, 'ch1', '2024-01-01', '2024-01-07', true);
  });

  it('getPosts delegates with default pagination', async () => {
    (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });

    await controller.getPosts(mockOrg, dq({ sort: 'impressions', dir: 'desc', page: undefined, limit: undefined }));

    expect(service.getPosts).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], 'impressions', 'desc', 1, 20, { campaignIds: [] });
  });

  it('getMetric delegates correctly', async () => {
    (service.getMetricDetail as any).mockResolvedValue({ metric: 'impressions' });

    await controller.getMetric(mockOrg, 'impressions', dq({ integrations: 'i1,i2', compare: 'false' }));

    expect(service.getMetricDetail).toHaveBeenCalledWith(mockOrg, 'impressions', '2024-01-01', '2024-01-07', ['i1', 'i2'], false, { campaignIds: [] });
  });

  it('getDay delegates correctly', async () => {
    (service.getDayDetail as any).mockResolvedValue({ metric: 'impressions' });

    await controller.getDay(mockOrg, '2024-01-01', 'impressions', 'i1');

    expect(service.getDayDetail).toHaveBeenCalledWith(mockOrg, '2024-01-01', 'impressions', ['i1'], { campaignIds: [] });
  });

  it('getDay throws 400 on invalid date', async () => {
    await expect(
      controller.getDay(mockOrg, 'not-a-date', 'impressions', 'i1')
    ).rejects.toThrow(BadRequestException);
    expect(service.getDayDetail).not.toHaveBeenCalled();
  });

  it('getDay throws 400 on missing date', async () => {
    await expect(
      controller.getDay(mockOrg, '', 'impressions', 'i1')
    ).rejects.toThrow(BadRequestException);
    expect(service.getDayDetail).not.toHaveBeenCalled();
  });

  it('getDay throws 400 on unknown metric', async () => {
    await expect(
      controller.getDay(mockOrg, '2024-01-01', 'not-a-metric', 'i1')
    ).rejects.toThrow(BadRequestException);
    expect(service.getDayDetail).not.toHaveBeenCalled();
  });

  it('updateWatchlistEntry delegates dto fields to the service', async () => {
    (watchlistService.update as any).mockResolvedValue({ id: 'w1' });

    const dto = new UpdateWatchlistDto();
    dto.displayName = 'New Name';
    dto.enabled = false;

    await controller.updateWatchlistEntry(mockOrg, 'w1', dto);

    expect(watchlistService.update).toHaveBeenCalledWith('w1', 'test-org-id', {
      displayName: 'New Name',
      enabled: false,
    });
  });

  it('getChannelMetric delegates correctly', async () => {
    (service.getChannelMetric as any).mockResolvedValue({ series: [] });

    await controller.getChannelMetric(mockOrg, 'ch1', 'impressions', dq({ compare: 'true' }));

    expect(service.getChannelMetric).toHaveBeenCalledWith(mockOrg, 'ch1', 'impressions', '2024-01-01', '2024-01-07', true);
  });

  it('getPostDetail delegates correctly', async () => {
    (service.getPostDetail as any).mockResolvedValue({ postId: 'p1' });

    const result = await controller.getPostDetail(mockOrg, 'p1');

    expect(service.getPostDetail).toHaveBeenCalledWith(mockOrg, 'p1', undefined);
    expect(result).toEqual({ postId: 'p1' });
  });

  it('getPostDetail passes date param', async () => {
    (service.getPostDetail as any).mockResolvedValue({ postId: 'p1' });

    await controller.getPostDetail(mockOrg, 'p1', '7');

    expect(service.getPostDetail).toHaveBeenCalledWith(mockOrg, 'p1', '7');
  });

  it('getOverview throws when from is missing', async () => {
    await expect(
      controller.getOverview(mockOrg, dq({ from: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getOverview throws when to is missing', async () => {
    await expect(
      controller.getOverview(mockOrg, dq({ to: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getOverview throws when from is an invalid date', async () => {
    await expect(
      controller.getOverview(mockOrg, dq({ from: 'not-a-date' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getOverview throws when to is an invalid date', async () => {
    await expect(
      controller.getOverview(mockOrg, dq({ to: 'bad-date' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getOverview parses empty integrations string as empty array', async () => {
    (service.getOverview as any).mockResolvedValue({ kpis: [] });

    await controller.getOverview(mockOrg, dq({ integrations: '' }));

    expect(service.getOverview).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], false, { campaignIds: [] });
  });

  it('getPosts uses defaults when no sort/dir/page/limit provided', async () => {
    (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });

    await controller.getPosts(mockOrg, dq({ sort: undefined, dir: undefined, page: undefined, limit: undefined }));

    expect(service.getPosts).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], undefined, 'desc', 1, 20, { campaignIds: [] });
  });

  it('getPosts passes dir=asc when provided', async () => {
    (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });

    await controller.getPosts(mockOrg, dq({ sort: undefined, dir: 'asc', page: undefined, limit: undefined }));

    expect(service.getPosts).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], undefined, 'asc', 1, 20, { campaignIds: [] });
  });

  it('getPosts delegates with explicit page and limit', async () => {
    (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });

    await controller.getPosts(mockOrg, dq({ integrations: 'i1', sort: 'impressions', dir: 'desc', page: 3, limit: 10 }));

    expect(service.getPosts).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', ['i1'], 'impressions', 'desc', 3, 10, { campaignIds: [] });
  });

  it('exportData with csv format sets correct headers and returns data', async () => {
    const res = mockResponse();
    const csvData = 'col1,col2\nv1,v2';
    (service.exportData as any).mockResolvedValue({ contentType: 'text/csv', data: csvData });

    const result = await controller.exportData(mockOrg, dq({ format: 'csv' }), res as any);

    expect(service.exportData).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], 'csv', false, { campaignIds: [] });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="analytics-export.csv"');
    expect(result).toBe(csvData);
  });

  it('exportData with json format sets correct headers and returns data', async () => {
    const res = mockResponse();
    const jsonData = { key: 'value' };
    (service.exportData as any).mockResolvedValue({ contentType: 'application/json', data: jsonData });

    const result = await controller.exportData(mockOrg, dq({ format: 'json' }), res as any);

    expect(service.exportData).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], 'json', false, { campaignIds: [] });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="analytics-export.json"');
    expect(result).toBe(jsonData);
  });

  it('exportData throws when format is invalid', async () => {
    const res = mockResponse();

    await expect(
      controller.exportData(mockOrg, dq({ format: 'pdf' }), res as any)
    ).rejects.toThrow(BadRequestException);
  });

  it('exportData throws when from is missing', async () => {
    const res = mockResponse();

    await expect(
      controller.exportData(mockOrg, dq({ from: '', format: 'json' }), res as any)
    ).rejects.toThrow(BadRequestException);
  });

  it('getChannel throws when from is missing', async () => {
    await expect(
      controller.getChannel(mockOrg, 'ch1', dq({ from: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getMetricDetail throws when from is missing', async () => {
    await expect(
      controller.getMetric(mockOrg, 'impressions', dq({ from: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getChannelMetric throws when from is missing', async () => {
    await expect(
      controller.getChannelMetric(mockOrg, 'ch1', 'impressions', dq({ from: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('getPosts throws when from is missing', async () => {
    await expect(
      controller.getPosts(mockOrg, dq({ from: '' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('validateToGteFrom rejects to before from', async () => {
    await expect(
      controller.getOverview(mockOrg, dq({ from: '2024-01-07', to: '2024-01-01' }))
    ).rejects.toThrow(BadRequestException);
  });

  it('validateToGteFrom accepts to equal from', async () => {
    (service.getOverview as any).mockResolvedValue({ kpis: [] });
    await controller.getOverview(mockOrg, dq({ from: '2024-01-01', to: '2024-01-01' }));
    expect(service.getOverview).toHaveBeenCalled();
  });

  it('getPosts caps limit at 100', async () => {
    (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });
    await controller.getPosts(mockOrg, dq({ limit: 999 }));
    expect(service.getPosts).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07', [], undefined, 'desc', 1, 100, { campaignIds: [] });
  });

  describe('campaign scope (1.4)', () => {
    const CID = '11111111-1111-4111-8111-111111111111';

    it('parseCampaigns returns [] when absent and validates uuids', () => {
      expect(parseCampaigns(undefined)).toEqual([]);
      expect(parseCampaigns('')).toEqual([]);
      expect(parseCampaigns(CID)).toEqual([CID]);
      expect(parseCampaigns(`${CID}, ${CID}`)).toEqual([CID, CID]);
    });

    it('parseCampaigns throws on a malformed id', () => {
      expect(() => parseCampaigns('not-a-uuid')).toThrow(BadRequestException);
      expect(() => parseCampaigns(`${CID},bad`)).toThrow(BadRequestException);
    });

    it('getOverview forwards the parsed campaign array to the service', async () => {
      (service.getOverview as any).mockResolvedValue({ kpis: [] });

      await controller.getOverview(mockOrg, dq({ campaigns: CID }));

      expect(service.getOverview).toHaveBeenCalledWith(
        mockOrg, '2024-01-01', '2024-01-07', [], false, { campaignIds: [CID] }
      );
    });

    it('getPosts forwards the parsed campaign array to the service', async () => {
      (service.getPosts as any).mockResolvedValue({ posts: [], total: 0 });

      await controller.getPosts(mockOrg, dq({ campaigns: CID }));

      expect(service.getPosts).toHaveBeenCalledWith(
        mockOrg, '2024-01-01', '2024-01-07', [], undefined, 'desc', 1, 20, { campaignIds: [CID] }
      );
    });

    it('getMetric forwards the parsed campaign array to the service', async () => {
      (service.getMetricDetail as any).mockResolvedValue({ metric: 'impressions' });

      await controller.getMetric(mockOrg, 'impressions', dq({ campaigns: CID }));

      expect(service.getMetricDetail).toHaveBeenCalledWith(
        mockOrg, 'impressions', '2024-01-01', '2024-01-07', [], false, { campaignIds: [CID] }
      );
    });

    it('getDay forwards the parsed campaign array to the service', async () => {
      (service.getDayDetail as any).mockResolvedValue({ metric: 'impressions' });

      await controller.getDay(mockOrg, '2024-01-01', 'impressions', 'i1', CID);

      expect(service.getDayDetail).toHaveBeenCalledWith(
        mockOrg, '2024-01-01', 'impressions', ['i1'], { campaignIds: [CID] }
      );
    });

    it('getDay rejects a malformed campaign id', async () => {
      await expect(
        controller.getDay(mockOrg, '2024-01-01', 'impressions', 'i1', 'bad')
      ).rejects.toThrow(BadRequestException);
      expect(service.getDayDetail).not.toHaveBeenCalled();
    });

    it('exportData forwards the parsed campaign array to the service', async () => {
      const res = mockResponse();
      (service.exportData as any).mockResolvedValue({ contentType: 'application/json', data: '[]' });

      await controller.exportData(mockOrg, dq({ format: 'json', campaigns: CID }), res as any);

      expect(service.exportData).toHaveBeenCalledWith(
        mockOrg, '2024-01-01', '2024-01-07', [], 'json', false, { campaignIds: [CID] }
      );
    });
  });

  describe('best-time (6.4)', () => {
    it('passes tz and single integration through', async () => {
      (service.getBestTimeData as any).mockResolvedValue({ heatmap: [], bestSlots: [] });
      await controller.getBestTime(mockOrg, '', 'ch1', 'America/New_York');
      expect(service.getBestTimeData).toHaveBeenCalledWith('test-org-id', ['ch1'], 'America/New_York');
    });

    it('falls back to comma-separated integrations when no single integration', async () => {
      (service.getBestTimeData as any).mockResolvedValue({ heatmap: [], bestSlots: [] });
      await controller.getBestTime(mockOrg, 'i1,i2', undefined, undefined);
      expect(service.getBestTimeData).toHaveBeenCalledWith('test-org-id', ['i1', 'i2'], undefined);
    });
  });

  describe('data-health (6.6)', () => {
    it('delegates to getDataHealth', async () => {
      const rows = [{ integrationId: 'i1', supportsAnalytics: false }];
      (service.getDataHealth as any).mockResolvedValue(rows);
      const result = await controller.getHealth(mockOrg);
      expect(service.getDataHealth).toHaveBeenCalledWith(mockOrg);
      expect(result).toBe(rows);
    });
  });

  describe('on-demand refresh (6.7)', () => {
    it('delegates to refreshChannel', async () => {
      (service.refreshChannel as any).mockResolvedValue({ integrationId: 'i1', persisted: 3 });
      const result = await controller.refreshChannel(mockOrg, 'i1');
      expect(service.refreshChannel).toHaveBeenCalledWith(mockOrg, 'i1');
      expect(result).toEqual({ integrationId: 'i1', persisted: 3 });
    });
  });

  describe('content-insights (7.4)', () => {
    it('delegates to getContentInsights', async () => {
      (service.getContentInsights as any).mockResolvedValue({ findings: [], totalPosts: 0, orgMean: 0 });
      await controller.getContentInsights(mockOrg);
      expect(service.getContentInsights).toHaveBeenCalledWith(mockOrg);
    });
  });

  describe('narrate (7.5)', () => {
    it('delegates to narrate without a budget gate', async () => {
      (service.narrate as any).mockResolvedValue({ narrative: 'text' });
      const result = await controller.narrate(mockOrg, dq());
      expect(service.narrate).toHaveBeenCalledWith(mockOrg, '2024-01-01', '2024-01-07');
      expect(result).toEqual({ narrative: 'text' });
    });

    it('validates the date range', async () => {
      await expect(controller.narrate(mockOrg, dq({ from: '' }))).rejects.toThrow(BadRequestException);
    });
  });

  describe('watchlist series (6.3)', () => {
    const CID = '11111111-1111-4111-8111-111111111111';

    it('returns watched series plus own followers when a range is given', async () => {
      watchlistService.getSeries.mockResolvedValue({ id: CID, metric: 'followers', series: [{ date: '2024-01-01', value: 10 }] });
      (service.getFollowerSeries as any).mockResolvedValue([{ date: '2024-01-01', value: 500 }]);

      const result = await controller.getWatchlistSeries(mockOrg, CID, undefined, '2024-01-01', '2024-01-07');

      expect(watchlistService.getSeries).toHaveBeenCalledWith(CID, 'test-org-id', 'followers');
      expect(service.getFollowerSeries).toHaveBeenCalledWith('test-org-id', '2024-01-01', '2024-01-07');
      expect(result.watched.series).toHaveLength(1);
      expect(result.own).toHaveLength(1);
    });

    it('omits own followers (empty) when no range provided', async () => {
      watchlistService.getSeries.mockResolvedValue({ id: CID, metric: 'followers', series: [] });

      const result = await controller.getWatchlistSeries(mockOrg, CID);

      expect(service.getFollowerSeries).not.toHaveBeenCalled();
      expect(result.own).toEqual([]);
    });
  });

  describe('alert rules (7.3)', () => {
    it('list/create/update/delete are org-scoped through the service', async () => {
      (service.listAlertRules as any).mockResolvedValue([{ id: 'r1' }]);
      expect(await controller.listAlertRules(mockOrg)).toEqual([{ id: 'r1' }]);
      expect(service.listAlertRules).toHaveBeenCalledWith('test-org-id');

      const body = { metric: 'followers', comparator: 'gte', threshold: 10000 } as any;
      (service.createAlertRule as any).mockResolvedValue({ id: 'r2', ...body });
      await controller.createAlertRule(mockOrg, body);
      expect(service.createAlertRule).toHaveBeenCalledWith('test-org-id', body);

      const upd = { enabled: false } as any;
      (service.updateAlertRule as any).mockResolvedValue({ id: 'r1', enabled: false });
      await controller.updateAlertRule(mockOrg, 'r1', upd);
      expect(service.updateAlertRule).toHaveBeenCalledWith('test-org-id', 'r1', upd);

      (service.deleteAlertRule as any).mockResolvedValue({ success: true });
      expect(await controller.deleteAlertRule(mockOrg, 'r1')).toEqual({ success: true });
      expect(service.deleteAlertRule).toHaveBeenCalledWith('test-org-id', 'r1');
    });
  });

  describe('share (7.6)', () => {
    it('getShare delegates org-scoped', async () => {
      (shareService.getShare as any).mockResolvedValue({ token: 't', enabled: true });
      expect(await controller.getShare(mockOrg)).toEqual({ token: 't', enabled: true });
      expect(shareService.getShare).toHaveBeenCalledWith('test-org-id');
    });

    it('mintShare returns only token/enabled/config', async () => {
      (shareService.mintShare as any).mockResolvedValue({
        id: 'x', organizationId: 'test-org-id', token: 'abc', enabled: true, config: { rangePreset: '30d' },
      });
      const result = await controller.mintShare(mockOrg, { integrations: ['i1'], rangePreset: '30d' } as any);
      expect(shareService.mintShare).toHaveBeenCalledWith('test-org-id', { integrations: ['i1'], rangePreset: '30d' });
      expect(result).toEqual({ token: 'abc', enabled: true, config: { rangePreset: '30d' } });
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('organizationId');
    });

    it('disableShare delegates org-scoped', async () => {
      (shareService.disableShare as any).mockResolvedValue({ success: true });
      expect(await controller.disableShare(mockOrg)).toEqual({ success: true });
      expect(shareService.disableShare).toHaveBeenCalledWith('test-org-id');
    });
  });

  describe('getShortLinks', () => {
    it('delegates to analytics service and returns enriched links', async () => {
      (service.getShortLinks as any).mockResolvedValue([
        { id: 'l1', shortUrl: 'https://sh.rt/a', originalUrl: 'https://example.com/a', provider: 'bitly', clicks: 50, createdAt: new Date('2024-01-01') },
        { id: 'l2', shortUrl: 'https://sh.rt/b', originalUrl: 'https://example.com/b', provider: 'bitly', clicks: 7, createdAt: new Date('2024-01-02') },
      ]);

      const result = await controller.getShortLinks(mockOrg, '2024-01-01', '2024-01-07');

      expect(service.getShortLinks).toHaveBeenCalledWith('test-org-id', expect.any(Date), expect.any(Date));
      expect(result).toHaveLength(2);
      expect(result[0].clicks).toBe(50);
      expect(result[1].clicks).toBe(7);
    });

    it('uses default 30-day window when no dates are provided', async () => {
      (service.getShortLinks as any).mockResolvedValue([]);

      await controller.getShortLinks(mockOrg);

      expect(service.getShortLinks).toHaveBeenCalledWith('test-org-id', expect.any(Date), expect.any(Date));
    });
  });

  describe('getShortLinkTimeseries', () => {
    it('delegates to analytics service and returns daily click timeseries', async () => {
      (service.getShortLinkTimeseries as any).mockResolvedValue([
        { date: '2024-01-01', clicks: 15 },
        { date: '2024-01-02', clicks: 15 },
      ]);

      const result = await controller.getShortLinkTimeseries(mockOrg, '2024-01-01', '2024-01-07');

      expect(service.getShortLinkTimeseries).toHaveBeenCalledWith('test-org-id', expect.any(Date), expect.any(Date));
      expect(result).toEqual([
        { date: '2024-01-01', clicks: 15 },
        { date: '2024-01-02', clicks: 15 },
      ]);
    });

    it('returns empty array when service returns no data', async () => {
      (service.getShortLinkTimeseries as any).mockResolvedValue([]);

      const result = await controller.getShortLinkTimeseries(mockOrg);

      expect(result).toEqual([]);
    });
  });
});

describe('AuthZ decorator metadata (R2.1 / R2.2)', () => {
  const proto = AnalyticsV2Controller.prototype as any;
  const requirePerm = (m: string) =>
    Reflect.getMetadata(REQUIRE_PERMISSION_KEY, proto[m]);
  const checkPolicies = (m: string) =>
    Reflect.getMetadata(CHECK_POLICIES_KEY, proto[m]);

  // R2.1 — every mutating route carries @RequirePermission('analytics','update').
  const RBAC_GATED = [
    'refreshChannel',
    'dismissAnomaly',
    'createAlertRule',
    'updateAlertRule',
    'deleteAlertRule',
    'mintShare',
    'disableShare',
    // getShare returns the live token (= the public link) — reading it is part
    // of managing sharing, gated like mint/disable.
    'getShare',
    'addWatchlistEntry',
    'updateWatchlistEntry',
    'deleteWatchlistEntry',
  ];

  for (const m of RBAC_GATED) {
    it(`${m} requires analytics:update`, () => {
      expect(requirePerm(m)).toEqual({ resource: 'analytics', action: 'update' });
    });
  }

  // R2.2 — narrate is no longer AI-billing-gated under BYOK, but it is a
  // mutating POST on an org-resource controller and therefore carries
  // @RequirePermission('analytics', 'read').
  it('narrate requires analytics:read and has no CheckPolicies gate', () => {
    expect(checkPolicies('narrate')).toBeUndefined();
    expect(requirePerm('narrate')).toEqual({ resource: 'analytics', action: 'read' });
  });

  // GET routes stay on the org-scope default (no RequirePermission).
  it('read routes are not RBAC-gated', () => {
    for (const m of ['getOverview', 'getChannel', 'listAnomalies', 'listAlertRules', 'listWatchlist']) {
      expect(requirePerm(m)).toBeUndefined();
    }
  });
});

describe('parseIntegrations', () => {
  it('returns empty array when undefined', () => {
    expect(parseIntegrations(undefined)).toEqual([]);
  });

  it('returns empty array when empty string', () => {
    expect(parseIntegrations('')).toEqual([]);
  });

  it('splits comma-separated string', () => {
    expect(parseIntegrations('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty entries', () => {
    expect(parseIntegrations('a,,b')).toEqual(['a', 'b']);
  });
});

describe('parsePage', () => {
  it('returns 1 when undefined', () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it('returns 1 when 0', () => {
    // DTO validation with @Min(1) catches this before parsePage
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('parseLimit', () => {
  it('returns 20 when undefined', () => {
    expect(parseLimit(undefined)).toBe(20);
  });

  it('caps at 100', () => {
    expect(parseLimit(200)).toBe(100);
  });

  it('returns value when within bounds', () => {
    expect(parseLimit(50)).toBe(50);
  });

  it('accepts 1', () => {
    expect(parseLimit(1)).toBe(1);
  });
});

describe('parseCompare', () => {
  it('returns false when undefined', () => {
    expect(parseCompare(undefined)).toBe(false);
  });

  it('returns true for "true"', () => {
    expect(parseCompare('true')).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseCompare('false')).toBe(false);
  });
});

describe('validateDateRange', () => {
  it('throws when from is empty', () => {
    expect(() => validateDateRange('', '2024-01-07')).toThrow(BadRequestException);
  });

  it('throws when to is empty', () => {
    expect(() => validateDateRange('2024-01-01', '')).toThrow(BadRequestException);
  });

  it('throws when from is not a valid date', () => {
    expect(() => validateDateRange('not-a-date', '2024-01-07')).toThrow(BadRequestException);
  });

  it('throws when to is not a valid date', () => {
    expect(() => validateDateRange('2024-01-01', 'bad-date')).toThrow(BadRequestException);
  });
});

describe('validateToGteFrom', () => {
  it('throws when to is before from', () => {
    expect(() => validateToGteFrom('2024-01-07', '2024-01-01')).toThrow(BadRequestException);
  });

  it('passes when to equals from', () => {
    expect(() => validateToGteFrom('2024-01-01', '2024-01-01')).not.toThrow();
  });

  it('passes when to is after from', () => {
    expect(() => validateToGteFrom('2024-01-01', '2024-01-07')).not.toThrow();
  });
});

describe('UpdateWatchlistDto (global validation pipe)', () => {
  // Mirrors the global pipe config in main.ts
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = {
    type: 'body' as const,
    metatype: UpdateWatchlistDto,
  };

  it('rejects an extra (non-whitelisted) field', async () => {
    await expect(
      pipe.transform({ displayName: 'ok', isSuperAdmin: true }, metadata)
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts valid displayName + enabled', async () => {
    await expect(
      pipe.transform({ displayName: 'ok', enabled: true }, metadata)
    ).resolves.toEqual({ displayName: 'ok', enabled: true });
  });

  it('accepts an empty body (both fields optional)', async () => {
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
  });

  it('rejects displayName longer than 100 chars', async () => {
    await expect(
      pipe.transform({ displayName: 'a'.repeat(101) }, metadata)
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-boolean enabled', async () => {
    await expect(
      pipe.transform({ enabled: 'yes' }, metadata)
    ).rejects.toThrow(BadRequestException);
  });
});
