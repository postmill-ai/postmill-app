import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

vi.mock('@sentry/nestjs', () => ({ metrics: { count: vi.fn() } }));
// neutralize the top-level CJS require of file-type
vi.mock('file-type', () => ({ fromBuffer: vi.fn() }));

import { HttpException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicAnalyticsV1Controller } from './public.analytics.v1.controller';

// Positional constructor args (PublicAnalyticsV1Controller): analyticsService,
// watchlistService, shareService, campaignsService.
const make = () => {
  const campaignsService = { get: vi.fn() };
  const analyticsService = { getOverview: vi.fn() };
  const ctrl = new (PublicAnalyticsV1Controller as any)(
    analyticsService,
    {}, // watchlistService
    {}, // shareService
    campaignsService,
  );
  return { ctrl, campaignsService, analyticsService };
};

describe('PublicAnalyticsV1Controller.getCampaignAnalytics — R2.4 date validation', () => {
  const org = { id: 'org-1' } as any;

  it('rejects a garbage from date with 400 (never calls analytics)', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(ctrl.getCampaignAnalytics(org, 'c-1', 'garbage', '2024-01-31')).rejects.toThrow(
      HttpException,
    );
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('rejects to before from with 400', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(ctrl.getCampaignAnalytics(org, 'c-1', '2024-02-01', '2024-01-01')).rejects.toThrow(
      HttpException,
    );
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('rejects a window wider than 400 days with a 400', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });

    await expect(
      ctrl.getCampaignAnalytics(org, 'c-1', '2020-01-01', '2024-01-01'),
    ).rejects.toThrow(expect.objectContaining({ status: 400 }));
    expect(analyticsService.getOverview).not.toHaveBeenCalled();
  });

  it('happy path composes campaign-scoped analytics with a valid window', async () => {
    const { ctrl, campaignsService, analyticsService } = make();
    campaignsService.get.mockResolvedValue({ id: 'c-1', organizationId: 'org-1' });
    analyticsService.getOverview.mockResolvedValue({ kpis: [], series: {}, byChannel: [] });

    const res = await ctrl.getCampaignAnalytics(org, 'c-1', '2024-01-01', '2024-01-31');
    expect(analyticsService.getOverview).toHaveBeenCalledWith(
      org,
      '2024-01-01',
      '2024-01-31',
      [],
      false,
      { campaignIds: ['c-1'] },
    );
    expect(res.window).toEqual({ from: '2024-01-01', to: '2024-01-31' });
  });
});

describe('Analytics unification — the ONE analytics home', () => {
  const analyticsProto = PublicAnalyticsV1Controller.prototype as any;
  const integrationsProto = PublicIntegrationsController.prototype as any;

  const path = (proto: any, m: string) => Reflect.getMetadata(PATH_METADATA, proto[m]);

  it('the full surface lives on PublicAnalyticsV1Controller at /public/v1/analytics/*', () => {
    expect(path(analyticsProto, 'getOverview')).toBe('/overview');
    expect(path(analyticsProto, 'getCampaignAnalytics')).toBe('/campaign/:id');
    expect(path(analyticsProto, 'listAnomalies')).toBe('/anomalies');
  });

  it('public.integrations.controller no longer hosts analytics routes', () => {
    // All analytics moved to PublicAnalyticsV1Controller — no duplicate
    // bindings for overview / campaign / anomalies on the integrations
    // controller.
    expect(integrationsProto.getAnalyticsOverview).toBeUndefined();
    expect(integrationsProto.getCampaignAnalytics).toBeUndefined();
    expect(integrationsProto.getAnomalies).toBeUndefined();
  });

  it('no legacy n8n/Zapier or /analytics/v2 shapes remain', () => {
    expect(integrationsProto.getAnalytics).toBeUndefined();
    expect(integrationsProto.getPostAnalytics).toBeUndefined();
    // The class-level controller path is the unified public one.
    expect(
      Reflect.getMetadata(PATH_METADATA, PublicAnalyticsV1Controller),
    ).toBe('/public/v1/analytics');
  });
});
