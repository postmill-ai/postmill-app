import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

const {
  redisStore,
  getAllowedSocialsIntegrations,
  getSocialIntegration,
  requireClientInformation,
  createOrUpdateIntegration,
  checkPreviousConnections,
  saveProviderPage,
  getOrgById,
  startRefreshWorkflow,
  tagItem,
} = vi.hoisted(() => ({
  redisStore: new Map<string, string>(),
  getAllowedSocialsIntegrations: vi.fn(),
  getSocialIntegration: vi.fn(),
  requireClientInformation: vi.fn(),
  createOrUpdateIntegration: vi.fn(),
  checkPreviousConnections: vi.fn(),
  saveProviderPage: vi.fn(),
  getOrgById: vi.fn(),
  startRefreshWorkflow: vi.fn(),
  tagItem: vi.fn(),
}));

vi.mock('@postmill-ai/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      redisStore.delete(key);
    }),
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {
    getAllowedSocialsIntegrations = getAllowedSocialsIntegrations;
    getSocialIntegration = getSocialIntegration;
    requireClientInformation = requireClientInformation;
  },
}));

vi.mock(
  '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({
    IntegrationService: class {
      createOrUpdateIntegration = createOrUpdateIntegration;
      checkPreviousConnections = checkPreviousConnections;
      saveProviderPage = saveProviderPage;
    },
  })
);

vi.mock(
  '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service',
  () => ({
    RefreshIntegrationService: class {
      startRefreshWorkflow = startRefreshWorkflow;
    },
  })
);

vi.mock(
  '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({
    OrganizationService: class {
      getOrgById = getOrgById;
    },
  })
);

vi.mock(
  '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-item.service',
  () => ({
    CampaignTagService: class {
      tagItem = tagItem;
    },
  })
);

vi.mock(
  '@postmill-ai/nestjs-libraries/integrations/integration.missing.scopes',
  () => ({ NotEnoughScopesFilter: class { catch() {} } })
);

vi.mock('@postmill-ai/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
  NotEnoughScopes: class {
    constructor(
      public message = 'Not enough scopes, when choosing a provider, please add all the scopes'
    ) {}
  },
}));

vi.mock(
  '@postmill-ai/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);

vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: class {
    static fixedEncryption = (value: string) => `enc:${value}`;
    static signJWT = () => 'signed-jwt';
    static verifyJWT = () => ({});
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: vi.fn(async () => ({})),
}));

vi.mock('@postmill-ai/nestjs-libraries/security/return-url.validator', () => ({
  isAllowedReturnUrl: () => true,
}));

import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postmill-ai/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from '@postmill-ai/nestjs-libraries/integrations/refresh.integration.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';
import { CampaignTagService } from '@postmill-ai/nestjs-libraries/database/prisma/campaigns/campaign-item.service';
import { ioRedis } from '@postmill-ai/nestjs-libraries/redis/redis.service';

const authDetails = {
  accessToken: 'access-token',
  expiresIn: 3600,
  refreshToken: 'refresh-token',
  id: 'prov-123',
  name: 'Test Channel',
  picture: 'https://pic.example/x.png',
  username: 'testuser',
  additionalSettings: [],
};

const makeProvider = (overrides: Record<string, any> = {}) => ({
  customFields: false,
  isBetweenSteps: false,
  externalUrl: undefined,
  oneTimeToken: false,
  isChromeExtension: false,
  authenticate: vi.fn(async () => ({ ...authDetails })),
  ...overrides,
});

const body = (state: string, extra: Record<string, any> = {}) =>
  ({ state, code: 'code', timezone: '0', ...extra }) as any;

describe('NoAuthIntegrationsController — OAuth state replay (F11)', () => {
  let controller: NoAuthIntegrationsController;

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();

    getAllowedSocialsIntegrations.mockReturnValue(['testprovider']);
    requireClientInformation.mockResolvedValue({});
    getOrgById.mockResolvedValue({ id: 'org-1', isTrailing: false });
    createOrUpdateIntegration.mockResolvedValue({
      id: 'int-1',
      token: 't',
      refreshToken: 'r',
      customInstanceDetails: 'c',
    });
    checkPreviousConnections.mockResolvedValue(false);
    startRefreshWorkflow.mockResolvedValue(undefined);

    controller = new NoAuthIntegrationsController(
      new (IntegrationManager as any)(),
      new (IntegrationService as any)(),
      new (RefreshIntegrationService as any)(),
      new (OrganizationService as any)(),
      new (CampaignTagService as any)()
    );
  });

  it('customFields provider: consumes organization:${state} — a second POST with the same state is rejected', async () => {
    const provider = makeProvider({ customFields: true });
    getSocialIntegration.mockResolvedValue(provider);
    // customFields providers have no `login:` key — `organization:` is the only
    // capability key, so this is the path that stayed replayable pre-F11.
    redisStore.set('organization:state-cf', 'org-1');

    const first = await controller.connectSocialMedia(
      'testprovider',
      body('state-cf')
    );
    expect(first.id).toBe('int-1');
    expect(ioRedis.del).toHaveBeenCalledWith('organization:state-cf');

    await expect(
      controller.connectSocialMedia('testprovider', body('state-cf'))
    ).rejects.toThrow('Invalid or expired state');
    expect(provider.authenticate).toHaveBeenCalledTimes(1);
  });

  it('standard OAuth provider: consumes both login: and organization: keys', async () => {
    const provider = makeProvider();
    getSocialIntegration.mockResolvedValue(provider);
    redisStore.set('login:state-1', 'verifier');
    redisStore.set('organization:state-1', 'org-1');

    await controller.connectSocialMedia('testprovider', body('state-1'));

    expect(ioRedis.del).toHaveBeenCalledWith('login:state-1');
    expect(ioRedis.del).toHaveBeenCalledWith('organization:state-1');
    expect(redisStore.has('login:state-1')).toBe(false);
    expect(redisStore.has('organization:state-1')).toBe(false);

    await expect(
      controller.connectSocialMedia('testprovider', body('state-1'))
    ).rejects.toThrow('Invalid or expired state');
    expect(provider.authenticate).toHaveBeenCalledTimes(1);
  });

  it('two-step provider: keeps organization:${state} for the page-selection save but still blocks connect replay', async () => {
    const provider = makeProvider({
      isBetweenSteps: true,
      pages: vi.fn(async () => [{ id: 'p1' }]),
    });
    getSocialIntegration.mockResolvedValue(provider);
    redisStore.set('login:state-2', 'verifier');
    redisStore.set('organization:state-2', 'org-1');

    const first = await controller.connectSocialMedia(
      'testprovider',
      body('state-2')
    );
    expect(first.pages).toEqual([{ id: 'p1' }]);

    // `organization:` must survive — saveProviderPage re-reads it with the same
    // state — while the consumed `login:` key already blocks a connect replay.
    expect(ioRedis.del).not.toHaveBeenCalledWith('organization:state-2');
    await expect(
      controller.connectSocialMedia('testprovider', body('state-2'))
    ).rejects.toThrow('Invalid or expired state');

    const pageBody = { state: 'state-2', page: 'p1' } as any;
    await controller.saveProviderPage('int-1', pageBody);
    expect(saveProviderPage).toHaveBeenCalledWith('org-1', 'int-1', pageBody);
  });

  it('refresh flow: consumes organization:${state} even for two-step providers', async () => {
    const provider = makeProvider({
      isBetweenSteps: true,
      reConnect: vi.fn(async () => ({ ...authDetails })),
    });
    getSocialIntegration.mockResolvedValue(provider);
    redisStore.set('login:state-3', 'verifier');
    redisStore.set('organization:state-3', 'org-3');
    redisStore.set('refresh:state-3', authDetails.id);

    await controller.connectSocialMedia(
      'testprovider',
      body('state-3', { refresh: authDetails.id })
    );

    expect(provider.reConnect).toHaveBeenCalledWith(
      authDetails.id,
      authDetails.id,
      authDetails.accessToken
    );
    expect(ioRedis.del).toHaveBeenCalledWith('organization:state-3');

    await expect(
      controller.connectSocialMedia(
        'testprovider',
        body('state-3', { refresh: authDetails.id })
      )
    ).rejects.toThrow('Invalid or expired state');
  });

  it('externalUrl provider: merges the stashed dynamic credentials into authenticate and persists them encrypted', async () => {
    const provider = makeProvider({
      externalUrl: async () => ({ client_id: 'dyn-id', client_secret: 'dyn-secret' }),
    });
    getSocialIntegration.mockResolvedValue(provider);
    requireClientInformation.mockResolvedValue({
      client_id: 'static-id',
      client_secret: 'static-secret',
    });
    redisStore.set('login:state-ext', 'verifier');
    redisStore.set('organization:state-ext', 'org-1');
    const externalDetails = JSON.stringify({
      client_id: 'dyn-id',
      client_secret: 'dyn-secret',
      instanceUrl: 'https://mastodon.example',
    });
    redisStore.set('external:state-ext', externalDetails);

    await controller.connectSocialMedia('testprovider', body('state-ext'));

    // The per-instance app credentials (and instanceUrl) must reach the token
    // exchange, winning over the static org/env app.
    expect(provider.authenticate).toHaveBeenCalledWith(
      { code: 'code', codeVerifier: 'verifier', refresh: undefined },
      {
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://mastodon.example',
      }
    );
    // The one-time Redis stash is consumed and persisted encrypted as
    // customInstanceDetails (arg 16 of createOrUpdateIntegration).
    expect(redisStore.has('external:state-ext')).toBe(false);
    expect(createOrUpdateIntegration.mock.calls[0][15]).toBe(
      `enc:${externalDetails}`
    );
  });

  it('externalUrl provider: works when the deployment has no static credentials at all', async () => {
    const provider = makeProvider({
      externalUrl: async () => ({ client_id: 'dyn-id', client_secret: 'dyn-secret' }),
    });
    getSocialIntegration.mockResolvedValue(provider);
    requireClientInformation.mockRejectedValue(new Error('not configured'));
    redisStore.set('login:state-ext2', 'verifier');
    redisStore.set('organization:state-ext2', 'org-1');
    redisStore.set(
      'external:state-ext2',
      JSON.stringify({
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://mastodon.example',
      })
    );

    const result = await controller.connectSocialMedia(
      'testprovider',
      body('state-ext2')
    );

    expect(result.id).toBe('int-1');
    expect(provider.authenticate).toHaveBeenCalledWith(
      expect.anything(),
      {
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://mastodon.example',
      }
    );
  });

  it('unknown/expired state: rejects with 400 "Invalid or expired state" (not a bare 500)', async () => {
    const provider = makeProvider();
    getSocialIntegration.mockResolvedValue(provider);
    // nothing in redis for this state

    const err = await controller
      .connectSocialMedia('testprovider', body('state-gone'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Invalid or expired state');

    // customFields provider with no organization: key — same contract
    const cfProvider = makeProvider({ customFields: true });
    getSocialIntegration.mockResolvedValue(cfProvider);
    const err2 = await controller
      .connectSocialMedia('testprovider', body('state-gone'))
      .catch((e) => e);
    expect(err2).toBeInstanceOf(BadRequestException);
    expect(err2.message).toBe('Invalid or expired state');
  });
});
