import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpsert = vi.fn();
const mockGetProviders = vi.fn();
const mockGetProviderMetadata = vi.fn();
const mockTestConnection = vi.fn();
const mockDelete = vi.fn();

vi.mock('@gitroom/nestjs-libraries/vpn/org-vpn-config.service', () => ({
  OrgVpnConfigService: class {
    upsert = mockUpsert;
    getProviders = mockGetProviders;
    getProviderMetadata = mockGetProviderMetadata;
    testConnection = mockTestConnection;
    delete = mockDelete;
  },
}));

import { OrgVpnSettingsController } from './org-vpn-settings.controller';
import { OrgVpnConfigService } from '@gitroom/nestjs-libraries/vpn/org-vpn-config.service';

const org = { id: 'org-1' } as any;

describe('OrgVpnSettingsController', () => {
  let controller: OrgVpnSettingsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new OrgVpnSettingsController(new (OrgVpnConfigService as any)());
  });

  it('delegates upsertConfig to the service without inline region validation', async () => {
    mockUpsert.mockResolvedValue({ id: 'cfg-1' });

    const result = await controller.upsertConfig(org, 'custom', {
      regions: ['us-east', 'eu-west'],
      enabled: true,
    });

    expect(mockUpsert).toHaveBeenCalledWith('org-1', 'custom', {
      regions: ['us-east', 'eu-west'],
      enabled: true,
    });
    expect(result).toEqual({ identifier: 'custom', success: true });
  });
});
