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

describe('PublicIntegrationsController — R2.7 analytics route registration order', () => {
  const proto = PublicIntegrationsController.prototype as any;

  const path = (m: string) => Reflect.getMetadata(PATH_METADATA, proto[m]);

  it('the overview handler is bound to the static /analytics/overview path', () => {
    expect(path('getAnalyticsOverview')).toBe('/analytics/overview');
    expect(path('getAnalytics')).toBe('/analytics/:integration');
  });

  it('registers /analytics/overview BEFORE the /analytics/:integration param route', () => {
    // Express matches by registration order = method declaration order on the
    // prototype. The static overview route must be declared first, else it is
    // captured as integration="overview".
    const names = Object.getOwnPropertyNames(proto);
    const overviewIdx = names.indexOf('getAnalyticsOverview');
    const paramIdx = names.indexOf('getAnalytics');
    expect(overviewIdx).toBeGreaterThanOrEqual(0);
    expect(paramIdx).toBeGreaterThanOrEqual(0);
    expect(overviewIdx).toBeLessThan(paramIdx);
  });
});
