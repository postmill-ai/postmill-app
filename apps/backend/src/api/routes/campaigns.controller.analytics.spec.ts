import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('@gitroom/nestjs-libraries/analytics/analytics.service', () => ({
  AnalyticsService: class {
    getOverview = vi.fn();
  },
}));

import { CampaignsController } from './campaigns.controller';

describe('CampaignsController.getAnalytics (1.5 — controller composition)', () => {
  const org = { id: 'org-1' } as any;

  const make = () => {
    const campaignsService = { get: vi.fn() };
    const analyticsService = { getOverview: vi.fn() };
    // positional: campaignsService, tagService, postsService, reportService,
    // noteService, analyticsService.
    const ctrl = new (CampaignsController as any)(
      campaignsService,
      {},
      {},
      {},
      {},
      analyticsService,
    );
    return { ctrl, campaignsService, analyticsService };
  };

  it('returns 404 for a missing / cross-org campaign (and never calls analytics)', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue(null);

    await expect(ctrl.getAnalytics(org, 'c-x')).rejects.toThrow(NotFoundException);
    expect(campaignsService.get).toHaveBeenCalledWith('c-x', 'org-1');
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('happy path composes campaign-scoped analytics and returns series + byChannel + window', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });
    analyticsService.getOverview.mockResolvedValue({
      range: { from: 'x', to: 'y' },
      kpis: [],
      series: { impressions: [{ date: '2024-01-01', value: 10 }] },
      byChannel: [{ integrationId: 'i1', name: 'IG' }],
      breakdown: { byPlatform: [] },
      scope: 'campaign-posts',
    });

    const res = await ctrl.getAnalytics(org, 'c-1', '2024-01-01', '2024-01-31');

    expect(campaignsService.get).toHaveBeenCalledWith('c-1', 'org-1');
    expect(analyticsService.getOverview).toHaveBeenCalledWith(
      org,
      '2024-01-01',
      '2024-01-31',
      [],
      false,
      { campaignIds: ['c-1'] },
    );
    expect(res.series.impressions).toHaveLength(1);
    expect(res.byChannel[0].integrationId).toBe('i1');
    expect(res.window).toEqual({ from: '2024-01-01', to: '2024-01-31' });
    expect(res.scope).toBe('campaign-posts');
  });

  // R2.4 — date-range validation on the campaign-analytics route.
  it('rejects a garbage from date with 400 (never calls analytics)', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(ctrl.getAnalytics(org, 'c-1', 'garbage', '2024-01-31')).rejects.toThrow(
      BadRequestException,
    );
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('rejects to before from with 400', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(ctrl.getAnalytics(org, 'c-1', '2024-02-01', '2024-01-01')).rejects.toThrow(
      BadRequestException,
    );
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('rejects a window wider than 400 days with 400', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(ctrl.getAnalytics(org, 'c-1', '2020-01-01', '2024-01-01')).rejects.toThrow(
      BadRequestException,
    );
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('defaults the window to a 90-day range when from/to are omitted', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1' });
    analyticsService.getOverview.mockResolvedValue({
      kpis: [],
      series: {},
      byChannel: [],
      breakdown: { byPlatform: [] },
    });

    const res = await ctrl.getAnalytics(org, 'c-1');

    const call = analyticsService.getOverview.mock.calls[0];
    expect(typeof call[1]).toBe('string'); // from
    expect(typeof call[2]).toBe('string'); // to
    expect(res.window.from).toBe(call[1]);
    expect(res.window.to).toBe(call[2]);
  });
});
