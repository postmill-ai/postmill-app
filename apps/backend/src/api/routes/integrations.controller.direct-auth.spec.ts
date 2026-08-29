import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { IntegrationsController } from './integrations.controller';

// 'direct' channels (Bluesky & co.) connect with ACCOUNT credentials entered in
// the connect form — there is no developer app, so requiring org-level client
// information makes them unconnectable (observed live: generateAuthUrl never ran,
// state stayed undefined, and the callback 500'd).
describe('IntegrationsController.getIntegrationUrl — direct channels skip app-credential requirement', () => {
  const org = { id: 'org-1' } as any;

  const makeController = (provider: any) => {
    const manager = {
      getAllowedSocialsIntegrations: () => ['bluesky', 'facebook'],
      getSocialIntegration: vi.fn().mockResolvedValue(provider),
      getClientInformation: vi.fn().mockResolvedValue(undefined),
      requireClientInformation: vi.fn().mockResolvedValue({}),
      generateAuthUrl: vi.fn().mockResolvedValue({ url: 'ok' }),
    };
    const controller = new IntegrationsController(
      manager as any,
      {} as any, // IntegrationService
      {} as any, // PostsService
      {} as any, // CampaignsService
      ...Array(20).fill({} as any)
    );
    return { controller, manager };
  };

  it('authType "direct": uses optional getClientInformation, not requireClientInformation', async () => {
    const { controller, manager } = makeController({
      setupDescriptor: { authType: 'direct' },
    });
    const result = await controller.getIntegrationUrl('bluesky', '', '', '', '', '', '', org);
    expect(result).toEqual({ url: 'ok' });
    expect(manager.getClientInformation).toHaveBeenCalledWith('bluesky', 'org-1', undefined);
    expect(manager.requireClientInformation).not.toHaveBeenCalled();
  });

  it('no descriptor / oauth2: still requires app credentials (unchanged behavior)', async () => {
    const { controller, manager } = makeController({
      setupDescriptor: { authType: 'oauth2' },
    });
    await controller.getIntegrationUrl('facebook', '', '', '', '', '', '', org);
    expect(manager.requireClientInformation).toHaveBeenCalledWith('facebook', 'org-1', undefined);
    expect(manager.getClientInformation).not.toHaveBeenCalled();
  });

  it('externalUrl providers keep the optional path (regression guard)', async () => {
    const { controller, manager } = makeController({ externalUrl: vi.fn() });
    await controller.getIntegrationUrl('bluesky', '', 'https://bsky.example', '', '', '', '', org);
    expect(manager.getClientInformation).toHaveBeenCalled();
    expect(manager.requireClientInformation).not.toHaveBeenCalled();
  });
});
