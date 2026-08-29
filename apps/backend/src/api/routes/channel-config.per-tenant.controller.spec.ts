import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { ChannelConfigPerTenantController } from './channel-config.per-tenant.controller';

// displayValues: non-secret stored credentials (App ID, FBfB configId, …) are
// returned for edit-mode prefill; descriptor-secret fields are never included.
describe('ChannelConfigPerTenantController — displayValues', () => {
  const org = { id: 'org-1' } as any;

  const makeController = () => {
    const service = {
      getConfigs: vi.fn().mockResolvedValue([
        { id: 'cfg-1', identifier: 'facebook', isConfigured: true },
        { id: 'cfg-2', identifier: 'telegram', isConfigured: true },
        { id: 'cfg-3', identifier: 'bluesky', isConfigured: false },
      ]),
      getDecryptedConfigs: vi.fn().mockResolvedValue([
        {
          id: 'cfg-1',
          clientId: 'app-id-123',
          clientSecret: 'top-secret',
          additionalConfig: JSON.stringify({ configId: 'cfg-456' }),
        },
        {
          id: 'cfg-2',
          clientId: 'bot-token-secret',
          clientSecret: undefined,
          additionalConfig: undefined,
        },
        // cfg-3 deliberately has NO catalog entry (edge: descriptor-less
        // fallback pair) but does have decrypted values
        { id: 'cfg-3', clientId: 'bsky-id', clientSecret: 'hidden', additionalConfig: undefined },
      ]),
    };
    const manager = {
      getSocialProviderCatalog: vi.fn().mockResolvedValue([
        {
          identifier: 'facebook',
          capabilities: null,
          setup: {
            credentialFields: [
              { key: 'clientId', label: 'App ID' },
              { key: 'clientSecret', label: 'App Secret', secret: true },
              { key: 'configId', label: 'Configuration ID', optional: true },
            ],
          },
        },
        {
          identifier: 'telegram',
          capabilities: null,
          setup: {
            credentialFields: [{ key: 'clientId', label: 'Bot Token', secret: true }],
          },
        },
        // bluesky has no catalog entry (edge: no descriptor)
      ]),
    };
    return new ChannelConfigPerTenantController(service as any, {} as any, manager as any);
  };

  it('returns non-secret fields, never secret-marked ones', async () => {
    const controller = makeController();
    const rows = await controller.listConfigs(org);

    const fb = rows.find((r: any) => r.id === 'cfg-1') as any;
    expect(fb.displayValues).toEqual({ clientId: 'app-id-123', configId: 'cfg-456' });
    expect(JSON.stringify(fb.displayValues)).not.toContain('top-secret');

    // telegram's bot token IS the clientId but marked secret — withheld
    const tg = rows.find((r: any) => r.id === 'cfg-2') as any;
    expect(tg.displayValues).toEqual({});

    // descriptor-less provider falls back to: clientId shown, clientSecret withheld
    const bsky = rows.find((r: any) => r.id === 'cfg-3') as any;
    expect(bsky.displayValues).toEqual({ clientId: 'bsky-id' });
  });

  it('tolerates a malformed additionalConfig blob instead of failing the list', async () => {
    const controller = makeController();
    (controller as any)._orgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
      { id: 'cfg-1', clientId: 'app-id-123', clientSecret: 'x', additionalConfig: '{not json' },
      { id: 'cfg-2', clientId: 's', additionalConfig: undefined },
    ]);
    const rows = await controller.listConfigs(org);
    const fb = rows.find((r: any) => r.id === 'cfg-1') as any;
    expect(fb.displayValues).toEqual({ clientId: 'app-id-123' });
  });
});
