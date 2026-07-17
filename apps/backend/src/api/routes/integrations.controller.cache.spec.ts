import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Organization } from '@prisma/client';

const getIntegrationListResponse = vi.fn();
const invalidateIntegrationListCache = vi.fn();

vi.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {
    getIntegrationListResponse = getIntegrationListResponse;
    invalidateIntegrationListCache = invalidateIntegrationListCache;
  },
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/campaigns/campaigns.service',
  () => ({ CampaignsService: class {} })
);

import { IntegrationsController } from './integrations.controller';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

const org = { id: 'org-1' } as Organization;

describe('IntegrationsController — delegation (A-19)', () => {
  let controller: IntegrationsController;
  let manager: IntegrationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new (IntegrationManager as any)();
    controller = new IntegrationsController(
      manager as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  it('delegates getIntegrationList to IntegrationManager.getIntegrationListResponse', async () => {
    getIntegrationListResponse.mockResolvedValue({ integrations: [] });

    const res = await controller.getIntegrationList(org);

    expect(res).toEqual({ integrations: [] });
    expect(getIntegrationListResponse).toHaveBeenCalledWith('org-1');
  });

  it('delegates list invalidation to IntegrationManager.invalidateIntegrationListCache', async () => {
    // The manager method is a thin delegate from every list-mutating handler.
    await (manager as any).invalidateIntegrationListCache('org-1');

    expect(invalidateIntegrationListCache).toHaveBeenCalledWith('org-1');
  });
});
