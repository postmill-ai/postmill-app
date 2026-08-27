import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { InvalidExternalUrlError } from '@postmill-ai/provider-kernel';

// Focused coverage for getIntegrationUrl error mapping: InvalidExternalUrlError
// from the manager must surface as HTTP 400 (a rejected promise previously
// escaped the try/catch entirely — un-awaited `return` — and became a 500).
describe('IntegrationsController.getIntegrationUrl error mapping', () => {
  const org = { id: 'org-1' } as any;

  const makeController = (generateAuthUrl: IntegrationsController['_integrationManager']['generateAuthUrl']) =>
    new IntegrationsController(
      {
        getAllowedSocialsIntegrations: () => ['mastodon'],
        getSocialIntegration: vi.fn().mockResolvedValue({ externalUrl: vi.fn() }),
        getClientInformation: vi.fn().mockResolvedValue(undefined),
        generateAuthUrl,
      } as any,
      {} as any, // IntegrationService
      {} as any, // PostsService
      {} as any, // CampaignsService
      ...Array(20).fill({} as any)
    );

  it('maps InvalidExternalUrlError to BadRequestException (400)', async () => {
    const controller = makeController(
      vi.fn().mockRejectedValue(new InvalidExternalUrlError('Instance URL must use https'))
    );
    await expect(
      controller.getIntegrationUrl('mastodon', '', 'http://internal.example', '', '', '', '', org)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns { err: true } for ordinary provider failures', async () => {
    const controller = makeController(vi.fn().mockRejectedValue(new Error('provider exploded')));
    const result = await controller.getIntegrationUrl('mastodon', '', 'https://mastodon.social', '', '', '', '', org);
    expect(result).toEqual({ err: true });
  });

  it('returns the auth url on success', async () => {
    const controller = makeController(vi.fn().mockResolvedValue({ url: 'https://mastodon.social/oauth/authorize?x=1' }));
    const result = await controller.getIntegrationUrl('mastodon', '', 'https://mastodon.social', '', '', '', '', org);
    expect(result).toEqual({ url: 'https://mastodon.social/oauth/authorize?x=1' });
  });
});
