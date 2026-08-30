import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';

vi.mock('@sentry/nestjs', () => ({ metrics: { count: vi.fn() } }));
// neutralize the top-level CJS require of file-type
vi.mock('file-type', () => ({ fromBuffer: vi.fn() }));

import { HttpException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PublicIntegrationsController } from './public.integrations.controller';

// Positional constructor args (see controller): analyticsService is index 6,
// campaignsService is index 11.
const make = () => {
  const campaignsService = { get: vi.fn() };
  const analyticsService = { getOverview: vi.fn() };
  const ctrl = new (PublicIntegrationsController as any)(
    {}, // integrationService
    {}, // postsService
    {}, // fileService
    {}, // notificationService
    {}, // integrationManager
    {}, // refreshIntegrationService
    analyticsService,
    {}, // storageService
    {}, // aiDefaults
    {}, // aiMediaService
    campaignsService,
  );
  return { ctrl, campaignsService, analyticsService };
};

describe('PublicIntegrationsController.getCampaignAnalytics — R2.4 date validation', () => {
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

describe('PublicIntegrationsController — v1 analytics routes (legacy removed)', () => {
  const proto = PublicIntegrationsController.prototype as any;

  const path = (m: string) => Reflect.getMetadata(PATH_METADATA, proto[m]);

  it('keeps the live static analytics routes', () => {
    expect(path('getAnalyticsOverview')).toBe('/analytics/overview');
    expect(path('getCampaignAnalytics')).toBe('/analytics/campaign/:id');
    expect(path('getAnomalies')).toBe('/analytics/anomalies');
  });

  it('no longer exposes the legacy n8n/Zapier analytics routes (404)', () => {
    // The handlers are gone, so Express has no binding for
    // GET /public/v1/analytics/:integration or
    // GET /public/v1/analytics/post/:postId — both 404.
    expect(proto.getAnalytics).toBeUndefined();
    expect(proto.getPostAnalytics).toBeUndefined();
  });
});
