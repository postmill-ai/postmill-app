import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, NotFoundException } from '@nestjs/common';
import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Hoisted helper – runs before vi.mock factories, so both are available when
// vi.mock factory callbacks are evaluated.
// ---------------------------------------------------------------------------
const { createMockProvider } = vi.hoisted(() => {
  return {
    createMockProvider: (
      identifier: string,
      name: string,
      overrides: Record<string, any> = {}
    ) => {
      const MockClass = class {};

      const defaults: Record<string, any> = {
        identifier,
        name,
        toolTip: name,
        editor: 'normal',
        isBetweenSteps: false,
        scopes: [],
        maxLength: () => 0,
        checkValidity: async () => true as const,
      };

      const merged = { ...defaults, ...overrides };

      for (const [key, value] of Object.entries(merged)) {
        Object.defineProperty(MockClass.prototype, key, {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      return MockClass;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock every social provider module so the IntegrationManager module can be
// imported without loading real provider dependencies (sharp, twitter-api-v2,
// node-telegram-bot-api, temporalio, prisma, etc.).
//
// Some providers are given extra properties to exercise specific branches of
// the IntegrationManager methods.
// ---------------------------------------------------------------------------

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/x.provider', () => ({
  XProvider: createMockProvider('x', 'X', {
    extensionCookies: [{ name: 'auth_token', domain: 'x.com' }],
    setupDescriptor: {
      authType: 'oauth1',
      credentialFields: [
        { key: 'clientId', label: 'API Key (Consumer Key)' },
        { key: 'clientSecret', label: 'API Secret (Consumer Secret)', secret: true },
      ],
      portalUrl: 'https://developer.x.com/en/portal/dashboard',
      portalLabel: 'X Developer Portal',
    },
  }),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/linkedin.provider', () => ({
  LinkedinProvider: createMockProvider('linkedin', 'LinkedIn'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/linkedin.page.provider', () => ({
  LinkedinPageProvider: createMockProvider('linkedinpage', 'LinkedIn Page'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/reddit.provider', () => ({
  RedditProvider: createMockProvider('reddit', 'Reddit'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/instagram.provider', () => ({
  InstagramProvider: createMockProvider('instagram', 'Instagram'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/instagram.standalone.provider', () => ({
  InstagramStandaloneProvider: createMockProvider('instagramstandalone', 'Instagram Standalone'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/facebook.provider', () => ({
  FacebookProvider: createMockProvider('facebook', 'Facebook'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/threads.provider', () => ({
  ThreadsProvider: createMockProvider('threads', 'Threads'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/youtube.provider', () => ({
  YoutubeProvider: createMockProvider('youtube', 'YouTube'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/gmb.provider', () => ({
  GmbProvider: createMockProvider('gmb', 'GMB'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/tiktok.provider', () => ({
  TiktokProvider: createMockProvider('tiktok', 'TikTok'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/pinterest.provider', () => ({
  PinterestProvider: createMockProvider('pinterest', 'Pinterest'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/dribbble.provider', () => ({
  DribbbleProvider: createMockProvider('dribbble', 'Dribbble'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/discord.provider', () => ({
  DiscordProvider: createMockProvider('discord', 'Discord', {
    externalUrl: async () => ({ client_id: 'd_id', client_secret: 'd_secret' }),
  }),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/slack.provider', () => ({
  SlackProvider: createMockProvider('slack', 'Slack'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/kick.provider', () => ({
  KickProvider: createMockProvider('kick', 'Kick'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/twitch.provider', () => ({
  TwitchProvider: createMockProvider('twitch', 'Twitch'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/mastodon.provider', () => ({
  MastodonProvider: createMockProvider('mastodon', 'Mastodon'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/bluesky.provider', () => ({
  BlueskyProvider: createMockProvider('bluesky', 'Bluesky'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/lemmy.provider', () => ({
  LemmyProvider: createMockProvider('lemmy', 'Lemmy'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/farcaster.provider', () => ({
  FarcasterProvider: createMockProvider('farcaster', 'Farcaster'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/telegram.provider', () => ({
  TelegramProvider: createMockProvider('telegram', 'Telegram', {
    isWeb3: true,
    customFields: async () => [
      {
        key: 'bot_token',
        label: 'Bot Token',
        defaultValue: '',
        validation: '^[0-9]+:[a-zA-Z0-9_-]+$',
        type: 'password' as const,
      },
    ],
  }),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/nostr.provider', () => ({
  NostrProvider: createMockProvider('nostr', 'Nostr'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/vk.provider', () => ({
  VkProvider: createMockProvider('vk', 'VK'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/medium.provider', () => ({
  MediumProvider: createMockProvider('medium', 'Medium'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/dev.to.provider', () => ({
  DevToProvider: createMockProvider('devto', 'DevTo'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/hashnode.provider', () => ({
  HashnodeProvider: createMockProvider('hashnode', 'Hashnode'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/wordpress.provider', () => ({
  WordpressProvider: createMockProvider('wordpress', 'WordPress'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/listmonk.provider', () => ({
  ListmonkProvider: createMockProvider('listmonk', 'Listmonk'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/moltbook.provider', () => ({
  MoltbookProvider: createMockProvider('moltbook', 'Moltbook'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/whop.provider', () => ({
  WhopProvider: createMockProvider('whop', 'Whop'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/skool.provider', () => ({
  SkoolProvider: createMockProvider('skool', 'Skool'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/mewe.provider', () => ({
  MeweProvider: createMockProvider('mewe', 'MeWe'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/tumblr.provider', () => ({
  TumblrProvider: createMockProvider('tumblr', 'Tumblr'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/pixelfed.provider', () => ({
  PixelfedProvider: createMockProvider('pixelfed', 'Pixelfed'),
}));

vi.mock('@postmill-ai/nestjs-libraries/integrations/social/peertube.provider', () => ({
  PeerTubeProvider: createMockProvider('peertube', 'PeerTube'),
}));

// Mock SocialAbstract to avoid pulling in sharp, temporalio, etc.
vi.mock('@postmill-ai/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
}));

// IntegrationManager injects the ProviderKernel DI token from providers.module;
// stub the module so this spec doesn't pull in the kernel's heavy provider graph
// (the manager is constructed manually with a fake kernel below).
vi.mock('@postmill-ai/nestjs-libraries/providers/providers.module', () => ({
  PROVIDER_KERNEL: Symbol('ProviderKernel'),
}));

// In-memory Redis so generateAuthUrl's state-binding writes can be asserted
// without a real server.
const { redisStore } = vi.hoisted(() => ({ redisStore: new Map<string, string>() }));
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

// ---------------------------------------------------------------------------
// Now it's safe to import the real module under test.
// ---------------------------------------------------------------------------
import { IntegrationManager } from '@postmill-ai/nestjs-libraries/integrations/integration.manager';
import { CHANNEL_ENV_MAPPINGS } from '@postmill-ai/nestjs-libraries/integrations/channel-env-credentials';

// Every env var that can platform-enable a provider — tests stub these to
// undefined by default so a configured developer shell can't leak platform
// apps into the expectations. Individual tests opt in via stubEnvApp().
const CHANNEL_ENV_VARS = [
  ...new Set(
    CHANNEL_ENV_MAPPINGS.flatMap((m) =>
      [m.clientIdEnv, m.clientSecretEnv, m.configIdEnv].filter(Boolean) as string[]
    )
  ),
];

// Configure a platform app for a provider via its env vars (the zero-config
// path). Pass the identifier from CHANNEL_ENV_MAPPINGS.
function stubEnvApp(identifier: string) {
  const mapping = CHANNEL_ENV_MAPPINGS.find((m) => m.identifier === identifier)!;
  vi.stubEnv(mapping.clientIdEnv, `${identifier}-id`);
  if (mapping.clientSecretEnv) {
    vi.stubEnv(mapping.clientSecretEnv, `${identifier}-secret`);
  }
}

// Populate the registry with the mock providers (mirrors the pre-7.5.1 static
// list, which the now-stubbed registration module would otherwise have filled).
import { XProvider } from '@postmill-ai/nestjs-libraries/integrations/social/x.provider';
import { LinkedinProvider } from '@postmill-ai/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@postmill-ai/nestjs-libraries/integrations/social/linkedin.page.provider';
import { RedditProvider } from '@postmill-ai/nestjs-libraries/integrations/social/reddit.provider';
import { InstagramProvider } from '@postmill-ai/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@postmill-ai/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { FacebookProvider } from '@postmill-ai/nestjs-libraries/integrations/social/facebook.provider';
import { ThreadsProvider } from '@postmill-ai/nestjs-libraries/integrations/social/threads.provider';
import { YoutubeProvider } from '@postmill-ai/nestjs-libraries/integrations/social/youtube.provider';
import { GmbProvider } from '@postmill-ai/nestjs-libraries/integrations/social/gmb.provider';
import { TiktokProvider } from '@postmill-ai/nestjs-libraries/integrations/social/tiktok.provider';
import { PinterestProvider } from '@postmill-ai/nestjs-libraries/integrations/social/pinterest.provider';
import { DribbbleProvider } from '@postmill-ai/nestjs-libraries/integrations/social/dribbble.provider';
import { DiscordProvider } from '@postmill-ai/nestjs-libraries/integrations/social/discord.provider';
import { SlackProvider } from '@postmill-ai/nestjs-libraries/integrations/social/slack.provider';
import { KickProvider } from '@postmill-ai/nestjs-libraries/integrations/social/kick.provider';
import { TwitchProvider } from '@postmill-ai/nestjs-libraries/integrations/social/twitch.provider';
import { MastodonProvider } from '@postmill-ai/nestjs-libraries/integrations/social/mastodon.provider';
import { BlueskyProvider } from '@postmill-ai/nestjs-libraries/integrations/social/bluesky.provider';
import { LemmyProvider } from '@postmill-ai/nestjs-libraries/integrations/social/lemmy.provider';
import { FarcasterProvider } from '@postmill-ai/nestjs-libraries/integrations/social/farcaster.provider';
import { TelegramProvider } from '@postmill-ai/nestjs-libraries/integrations/social/telegram.provider';
import { NostrProvider } from '@postmill-ai/nestjs-libraries/integrations/social/nostr.provider';
import { VkProvider } from '@postmill-ai/nestjs-libraries/integrations/social/vk.provider';
import { MediumProvider } from '@postmill-ai/nestjs-libraries/integrations/social/medium.provider';
import { DevToProvider } from '@postmill-ai/nestjs-libraries/integrations/social/dev.to.provider';
import { HashnodeProvider } from '@postmill-ai/nestjs-libraries/integrations/social/hashnode.provider';
import { WordpressProvider } from '@postmill-ai/nestjs-libraries/integrations/social/wordpress.provider';
import { ListmonkProvider } from '@postmill-ai/nestjs-libraries/integrations/social/listmonk.provider';
import { MoltbookProvider } from '@postmill-ai/nestjs-libraries/integrations/social/moltbook.provider';
import { WhopProvider } from '@postmill-ai/nestjs-libraries/integrations/social/whop.provider';
import { SkoolProvider } from '@postmill-ai/nestjs-libraries/integrations/social/skool.provider';
import { MeweProvider } from '@postmill-ai/nestjs-libraries/integrations/social/mewe.provider';
import { TumblrProvider } from '@postmill-ai/nestjs-libraries/integrations/social/tumblr.provider';
import { PixelfedProvider } from '@postmill-ai/nestjs-libraries/integrations/social/pixelfed.provider';
import { PeerTubeProvider } from '@postmill-ai/nestjs-libraries/integrations/social/peertube.provider';

// The raw social provider singletons now live in the ProviderKernel registry.
// Build a fake kernel over these mock provider instances; IntegrationManager
// resolves them through ProviderResolutionService and reads `rawProvider` from
// the capability bridge.
const providerInstances: any[] = [
  XProvider, LinkedinProvider, LinkedinPageProvider, RedditProvider,
  InstagramProvider, InstagramStandaloneProvider, FacebookProvider,
  ThreadsProvider, YoutubeProvider, GmbProvider, TiktokProvider,
  PinterestProvider, DribbbleProvider, DiscordProvider, SlackProvider,
  KickProvider, TwitchProvider, MastodonProvider, BlueskyProvider,
  LemmyProvider, FarcasterProvider, TelegramProvider, NostrProvider,
  VkProvider, MediumProvider, DevToProvider, HashnodeProvider,
  WordpressProvider, ListmonkProvider, MoltbookProvider, WhopProvider,
  SkoolProvider, MeweProvider, TumblrProvider, PixelfedProvider,
  PeerTubeProvider,
].map((P: any) => new P());

const providerById = new Map(
  providerInstances.map((p) => [p.identifier, p])
);

function moduleFor(id: string) {
  const provider = providerById.get(id);
  if (!provider) {
    return undefined;
  }
  return {
    manifest: { domain: 'social', providerId: id, version: 'v1', capabilities: {} },
    create: () => ({ rawProvider: provider }),
  };
}

const fakeKernel = {
  listManifests: (domain?: string) =>
    !domain || domain === 'social'
      ? providerInstances.map((p) => moduleFor(p.identifier)!.manifest)
      : [],
  get: (_domain: string, id: string, _version?: string) => moduleFor(id),
  latestActive: (_domain: string, id: string) => moduleFor(id),
} as any;

// Minimal fake for ProviderResolutionService — enough to exercise
// IntegrationManager's social-provider enumeration/lookup paths without pulling
// in the full kernel + runtime context factory.
function fakeResolutionService(kernel: any) {
  return {
    resolveProvider: (_domain: string, providerId: string, options: any) => {
      const version = options?.version;
      let mod: any;
      if (version !== undefined) {
        mod = kernel.get?.('social', providerId, version);
      } else {
        mod =
          kernel.get?.('social', providerId, 'v1') ??
          kernel.latestActive?.('social', providerId);
      }
      if (!mod) {
        throw new Error(
          `Provider not found: social/${providerId}@${version ?? 'latest'}`,
        );
      }
      const capability = mod.create ? mod.create() : { rawProvider: undefined };
      return {
        module: mod,
        capability,
        version: mod.manifest.version,
      };
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers to set up metadata on specific mock providers
// ---------------------------------------------------------------------------
function setToolMetadata(identifier: string, tools: any[]) {
  const p = providerById.get(identifier)!;
  Reflect.defineMetadata('custom:tool', tools, p.constructor.prototype);
}

function setRulesMetadata(identifier: string, description: string) {
  const p = providerById.get(identifier)!;
  Reflect.defineMetadata('custom:rules:description', description, p.constructor);
}

function setPlugMetadata(identifier: string, plugs: any[]) {
  const p = providerById.get(identifier)!;
  Reflect.defineMetadata('custom:plug', plugs, p.constructor.prototype);
}

function setInternalPlugMetadata(identifier: string, plugs: any[]) {
  const p = providerById.get(identifier)!;
  Reflect.defineMetadata('custom:internal_plug', plugs, p.constructor.prototype);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IntegrationManager', () => {
  let mockOrgPcm: {
    getEnabledIdentifiers: ReturnType<typeof vi.fn>;
    getAllConfigs: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
    getConfigById: ReturnType<typeof vi.fn>;
    getClientInfo: ReturnType<typeof vi.fn>;
    getClientInfoById: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    ensureFresh: ReturnType<typeof vi.fn>;
  };
  let manager: IntegrationManager;

  beforeEach(() => {
    // No platform apps unless a test opts in via stubEnvApp().
    for (const key of CHANNEL_ENV_VARS) {
      vi.stubEnv(key, undefined);
    }
    mockOrgPcm = {
      getEnabledIdentifiers: vi.fn(),
      getAllConfigs: vi.fn(),
      getConfig: vi.fn(),
      getConfigById: vi.fn(),
      getClientInfo: vi.fn(),
      getClientInfoById: vi.fn(),
      isEnabled: vi.fn(),
      ensureFresh: vi.fn(),
    };
    manager = new IntegrationManager(
      mockOrgPcm as any,
      fakeKernel,
      fakeResolutionService(fakeKernel),
    );

    // Clear all Reflect metadata from every provider to prevent test leakage
    for (const p of providerInstances) {
      Reflect.deleteMetadata('custom:tool', p.constructor.prototype);
      Reflect.deleteMetadata('custom:plug', p.constructor.prototype);
      Reflect.deleteMetadata('custom:internal_plug', p.constructor.prototype);
      Reflect.deleteMetadata('custom:rules:description', p.constructor);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---- getAllIntegrations ----

  describe('getAllIntegrations', () => {
    it('returns all providers when no org configs and no env apps exist (hasAnyConfigs = false)', async () => {
      const result = await manager.getAllIntegrations();

      expect(result.article).toEqual([]);
      // all 33 social providers should be returned
      expect(result.social.length).toBeGreaterThanOrEqual(36);
      expect(result.social.map((s: any) => s.identifier)).toContain('x');
      expect(result.social.map((s: any) => s.identifier)).toContain('telegram');
    });

    it('without orgId: lists env-enabled providers and marks them platformConfigured', async () => {
      stubEnvApp('x');
      stubEnvApp('linkedin');

      const result = await manager.getAllIntegrations();

      expect(result.social).toHaveLength(2);
      expect(result.social[0].identifier).toBe('x');
      expect(result.social[1].identifier).toBe('linkedin');
      expect(result.social[0].platformConfigured).toBe(true);
      // org scope is never consulted without an orgId
      expect(mockOrgPcm.getEnabledIdentifiers).not.toHaveBeenCalled();
      expect(mockOrgPcm.getAllConfigs).not.toHaveBeenCalled();
      expect(mockOrgPcm.getConfig).not.toHaveBeenCalled();
    });

    it('marks providers without an env app as platformConfigured: false', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['linkedin']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'linkedin', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social).toHaveLength(1);
      expect(result.social[0].platformConfigured).toBe(false);
    });

    it('org context: org-enabled and env-enabled providers list together', async () => {
      stubEnvApp('x');
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['instagramstandalone']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'instagramstandalone', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social.map((s: any) => s.identifier)).toEqual([
        'x',
        'instagramstandalone',
      ]);
      expect(
        result.social.find((s: any) => s.identifier === 'x').platformConfigured
      ).toBe(true);
      expect(
        result.social.find((s: any) => s.identifier === 'instagramstandalone')
          .platformConfigured
      ).toBe(false);
    });

    it('includes setupInstructions from the org config setupNotes', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue({
        identifier: 'x',
        setupNotes: 'Follow these steps...',
      } as any);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social[0].setupInstructions).toBe('Follow these steps...');
    });

    it('omits setupInstructions when the org config has none', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['linkedin']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'linkedin', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue({
        identifier: 'linkedin',
      } as any);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social[0].setupInstructions).toBeUndefined();
    });

    it('omits setupInstructions when the org config is undefined', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social[0].setupInstructions).toBeUndefined();
    });

    it('includes extensionCookies when provider has them', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social[0].extensionCookies).toEqual([
        { name: 'auth_token', domain: 'x.com' },
      ]);
    });

    it('includes customFields when provider has them', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue(['telegram']);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'telegram', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social[0].customFields).toEqual([
        {
          key: 'bot_token',
          label: 'Bot Token',
          defaultValue: '',
          validation: '^[0-9]+:[a-zA-Z0-9_-]+$',
          type: 'password',
        },
      ]);
    });

    it('maps isExternal, isWeb3 and isChromeExtension correctly', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue([
        'discord',
        'telegram',
      ]);
      mockOrgPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'discord', enabled: true } as any,
        { identifier: 'telegram', enabled: true } as any,
      ]);
      mockOrgPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations('org-1');

      const discord = result.social.find((s: any) => s.identifier === 'discord');
      expect(discord.isExternal).toBe(true);
      expect(discord.isWeb3).toBe(false);

      const telegram = result.social.find(
        (s: any) => s.identifier === 'telegram'
      );
      expect(telegram.isWeb3).toBe(true);
      expect(telegram.isChromeExtension).toBe(false);
    });

    it('org context: no org configs and no env apps → all providers listed', async () => {
      mockOrgPcm.getEnabledIdentifiers.mockResolvedValue([]);
      mockOrgPcm.getAllConfigs.mockResolvedValue([]);

      const result = await manager.getAllIntegrations('org-1');

      expect(result.social.length).toBeGreaterThanOrEqual(36);
      expect(result.social.map((s: any) => s.identifier)).toContain('x');
      expect(result.social.map((s: any) => s.identifier)).toContain(
        'instagramstandalone'
      );
    });
  });

  // ---- getAllTools ----

  describe('getAllTools', () => {
    it('returns tool metadata for providers that have it, empty arrays for others', () => {
      const toolData = [
        { description: 'Fetch channels', dataSchema: [], methodName: 'channels' },
      ];
      setToolMetadata('discord', toolData);

      const result = manager.getAllTools();

      expect(result.discord).toEqual(toolData);
      // provider without metadata gets empty array
      expect(result.x).toEqual([]);
      // every provider gets a key
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(36);
    });

    it('returns empty arrays for all providers when no tool metadata exists', () => {
      const result = manager.getAllTools();
      const ids = providerInstances.map((p) => p.identifier);
      for (const id of ids) {
        expect(result[id]).toEqual([]);
      }
    });
  });

  // ---- getAllRulesDescription ----

  describe('getAllRulesDescription', () => {
    it('returns rules description for providers that have it, empty string for others', () => {
      setRulesMetadata('x', 'X can have maximum 4 pictures');
      setRulesMetadata('linkedin', 'LinkedIn supports images and documents');

      const result = manager.getAllRulesDescription();

      expect(result.x).toBe('X can have maximum 4 pictures');
      expect(result.linkedin).toBe('LinkedIn supports images and documents');
      expect(result.discord).toBe('');
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(36);
    });

    it('returns empty string for every provider when no rules metadata exists', () => {
      const result = manager.getAllRulesDescription();
      const ids = providerInstances.map((p) => p.identifier);
      for (const id of ids) {
        expect(result[id]).toBe('');
      }
    });
  });

  // ---- getAllPlugs ----

  describe('getAllPlugs', () => {
    const enabledPlug = {
      identifier: 'x-autoRepost',
      title: 'Auto Repost',
      disabled: false,
      description: 'Repost when liked',
      runEveryMilliseconds: 21600000,
      totalRuns: 3,
      fields: [
        {
          name: 'likes',
          type: 'number',
          placeholder: 'Likes',
          description: 'Like count',
          validation: /^\d+$/,
        },
      ],
    };

    const disabledPlug = {
      identifier: 'x-disabled',
      title: 'Disabled Plug',
      disabled: true,
      description: 'This is disabled',
      runEveryMilliseconds: 3600000,
      totalRuns: 1,
      fields: [],
    };

    const plugWithRegexValidation = {
      identifier: 'x-regexPlug',
      title: 'Regex',
      disabled: false,
      description: 'Test',
      runEveryMilliseconds: 3600000,
      totalRuns: 1,
      fields: [
        {
          name: 'amount',
          type: 'number',
          placeholder: '',
          description: 'Amount',
          validation: /^[0-9]+$/,
        },
      ],
    };

    const plugWithoutValidation = {
      identifier: 'x-noValidation',
      title: 'No Validation',
      disabled: false,
      description: 'No validation',
      runEveryMilliseconds: 3600000,
      totalRuns: 1,
      fields: [
        {
          name: 'text',
          type: 'text',
          placeholder: '',
          description: 'Some text',
        },
      ],
    };

    it('returns only non-disabled plugs with validation converted to string', () => {
      setPlugMetadata('x', [enabledPlug, disabledPlug, plugWithRegexValidation, plugWithoutValidation]);

      const result = manager.getAllPlugs();

      const xEntry = result.find((p: any) => p.identifier === 'x');
      expect(xEntry).toBeDefined();
      expect(xEntry.plugs).toHaveLength(3);

      const repost = xEntry.plugs.find((p: any) => p.identifier === 'x-autoRepost');
      expect(repost.fields[0].validation).toBe('/^\\d+$/');

      const regexPlug = xEntry.plugs.find((p: any) => p.identifier === 'x-regexPlug');
      expect(regexPlug.fields[0].validation).toBe('/^[0-9]+$/');

      const noValPlug = xEntry.plugs.find((p: any) => p.identifier === 'x-noValidation');
      expect(noValPlug.fields[0].validation).toBeUndefined();
    });

    it('excludes providers whose plugs are all disabled', () => {
      setPlugMetadata('discord', [disabledPlug]);

      const result = manager.getAllPlugs();

      expect(result.find((p: any) => p.identifier === 'discord')).toBeUndefined();
    });

    it('excludes providers with no plugs metadata', () => {
      // slack has no plugs metadata set
      const result = manager.getAllPlugs();

      expect(result.find((p: any) => p.identifier === 'slack')).toBeUndefined();
    });

    it('returns empty array when no provider has any non-disabled plug', () => {
      // Ensure at least one plug metadata is set but all disabled
      setPlugMetadata('x', [disabledPlug]);
      // Clear any other metadata

      const result = manager.getAllPlugs();
      expect(result).toHaveLength(0);
    });
  });

  // ---- getInternalPlugs ----

  describe('getInternalPlugs', () => {
    it('returns internal plugs for a known provider (env-enabled)', async () => {
      stubEnvApp('x');

      const internalPlugs = [
        {
          identifier: 'post-user-repost',
          methodName: 'repostPostUsers',
          title: 'Add Re-posters',
          disabled: false,
          description: 'Add accounts',
        },
      ];
      setInternalPlugMetadata('x', internalPlugs);

      const result = await manager.getInternalPlugs('x');

      expect(result.internalPlugs).toHaveLength(1);
      expect(result.internalPlugs[0].identifier).toBe('post-user-repost');
    });

    it('returns internal plugs for an org-enabled provider', async () => {
      mockOrgPcm.isEnabled.mockResolvedValue(true);

      const internalPlugs = [
        {
          identifier: 'post-user-repost',
          methodName: 'repostPostUsers',
          title: 'Add Re-posters',
          disabled: false,
          description: 'Add accounts',
        },
      ];
      setInternalPlugMetadata('x', internalPlugs);

      const result = await manager.getInternalPlugs('x', 'org-1');

      expect(result.internalPlugs).toHaveLength(1);
      expect(mockOrgPcm.isEnabled).toHaveBeenCalledWith('org-1', 'x');
    });

    it('filters out disabled internal plugs', async () => {
      stubEnvApp('x');

      const internalPlugs = [
        {
          identifier: 'enabled-plug',
          methodName: 'enabledMethod',
          title: 'Enabled',
          disabled: false,
          description: '',
        },
        {
          identifier: 'disabled-plug',
          methodName: 'disabledMethod',
          title: 'Disabled',
          disabled: true,
          description: '',
        },
      ];
      setInternalPlugMetadata('x', internalPlugs);

      const result = await manager.getInternalPlugs('x');

      expect(result.internalPlugs).toHaveLength(1);
      expect(result.internalPlugs[0].identifier).toBe('enabled-plug');
    });

    it('returns empty internalPlugs for a known provider with no internal plug metadata', async () => {
      stubEnvApp('linkedin');

      const result = await manager.getInternalPlugs('linkedin');

      expect(result.internalPlugs).toEqual([]);
    });

    it('returns empty internalPlugs and logs warning for unknown provider', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      const result = await manager.getInternalPlugs('nonexistent');

      expect(result.internalPlugs).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Unknown provider 'nonexistent' requested in getInternalPlugs"
      );
      warnSpy.mockRestore();
    });

    it('throws NotFoundException when the provider is neither org- nor env-enabled', async () => {
      mockOrgPcm.isEnabled.mockResolvedValue(false);

      await expect(
        manager.getInternalPlugs('x', 'org-1')
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getAllowedSocialsIntegrations ----

  describe('getAllowedSocialsIntegrations', () => {
    it('returns all provider identifiers', () => {
      const result = manager.getAllowedSocialsIntegrations();

      expect(result).toContain('x');
      expect(result).toContain('linkedin');
      expect(result).toContain('discord');
      expect(result).toContain('telegram');
      expect(result.length).toBeGreaterThanOrEqual(36);
    });
  });

  // ---- getSocialIntegration ----

  describe('getSocialIntegration', () => {
    it('returns the provider for a known identifier (env-enabled)', async () => {
      stubEnvApp('x');

      const provider = await manager.getSocialIntegration('x');

      expect(provider).toBeDefined();
      expect(provider.identifier).toBe('x');
      expect(provider.name).toBe('X');
    });

    it('throws NotFoundException for an unknown identifier', async () => {
      await expect(
        manager.getSocialIntegration('unknown_provider')
      ).rejects.toThrow(NotFoundException);
    });

    it('throws with message containing the unknown identifier', async () => {
      try {
        await manager.getSocialIntegration('bogus');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('bogus');
      }
    });

    it('throws NotFoundException when the provider is neither org- nor env-enabled', async () => {
      mockOrgPcm.isEnabled.mockResolvedValue(false);

      await expect(
        manager.getSocialIntegration('x', 'org-1')
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getSocialIntegrationUnchecked ----

  describe('getSocialIntegrationUnchecked', () => {
    it('returns the provider for a known identifier without checking enabled state', () => {
      const provider = manager.getSocialIntegrationUnchecked('x');

      expect(provider).toBeDefined();
      expect(provider?.identifier).toBe('x');
      expect(mockOrgPcm.isEnabled).not.toHaveBeenCalled();
    });

    it('returns the provider even when it is disabled', () => {
      mockOrgPcm.isEnabled.mockResolvedValue(false);

      const provider = manager.getSocialIntegrationUnchecked('x');

      expect(provider?.identifier).toBe('x');
    });

    it('returns undefined for an unknown identifier', () => {
      expect(manager.getSocialIntegrationUnchecked('unknown_provider')).toBeUndefined();
    });
  });

  // ---- 2.7: org-only enablement passes orgId through ----

  describe('getSocialIntegration org-only enablement (2.7)', () => {
    it('resolves a provider enabled only via per-org config when orgId is passed', async () => {
      const orgPcm = { isEnabled: vi.fn().mockResolvedValue(true) };
      const m = new IntegrationManager(
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );

      const provider = await m.getSocialIntegration('x', 'org-1');

      expect(provider.identifier).toBe('x');
      expect(orgPcm.isEnabled).toHaveBeenCalledWith('org-1', 'x');
    });

    it('throws when the same org-only provider is resolved without an orgId (no env app)', async () => {
      const orgPcm = { isEnabled: vi.fn().mockResolvedValue(true) };
      const m = new IntegrationManager(
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );

      await expect(m.getSocialIntegration('x')).rejects.toThrow(NotFoundException);
      expect(orgPcm.isEnabled).not.toHaveBeenCalled();
    });

    it('resolves a provider enabled only via an env app (no org config)', async () => {
      stubEnvApp('x');
      const orgPcm = { isEnabled: vi.fn().mockResolvedValue(false) };
      const m = new IntegrationManager(
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );

      const provider = await m.getSocialIntegration('x', 'org-1');

      expect(provider.identifier).toBe('x');
    });
  });

  // ---- 4.13: version pinning + retired-status rejection ----

  describe('getSocialIntegrationUnchecked version pinning + retired status (4.13)', () => {
    const mkMod = (version: string, status: string, name: string) => ({
      manifest: {
        domain: 'social',
        providerId: 'demo',
        version,
        status,
        capabilities: {},
      },
      create: () => ({ rawProvider: { identifier: 'demo', name } }),
    });

    it('resolves the exact pinned version (a v2-pinned row runs the v2 adapter)', () => {
      const v1 = mkMod('v1', 'active', 'Demo v1');
      const v2 = mkMod('v2', 'active', 'Demo v2');
      const kernel = {
        get: (_d: string, _id: string, v: string) => (v === 'v2' ? v2 : v1),
        latestActive: () => v1,
        listManifests: () => [],
      } as any;
      const m = new IntegrationManager(
        {} as any,
        kernel,
        fakeResolutionService(kernel),
      );

      expect(m.getSocialIntegrationUnchecked('demo', 'v2')?.name).toBe('Demo v2');
      expect(m.getSocialIntegrationUnchecked('demo', 'v1')?.name).toBe('Demo v1');
    });

    it('returns undefined for a retired pinned version (1.3 — Unchecked must never throw)', () => {
      // 1.3: the Unchecked variant returns undefined (not throw) for a retired
      // pinned version so a single retired-pinned row can't abort a cross-org
      // sweep (channel list / token refresh rely on `if (!provider) continue`).
      // The CHECKED getSocialIntegration delegates here and therefore surfaces a
      // generic 404 ("Unknown integration") for a retired pin — the retired
      // wording/410 does not survive on that path.
      const retired = mkMod('v1', 'retired', 'Demo v1');
      const kernel = {
        get: () => retired,
        latestActive: () => retired,
        listManifests: () => [],
      } as any;
      const m = new IntegrationManager(
        {} as any,
        kernel,
        fakeResolutionService(kernel),
      );

      expect(m.getSocialIntegrationUnchecked('demo', 'v1')).toBeUndefined();
    });

    it('does not check status on the version-less listing path', () => {
      const retired = mkMod('v1', 'retired', 'Demo v1');
      const kernel = {
        get: () => retired,
        latestActive: () => retired,
        listManifests: () => [],
      } as any;
      const m = new IntegrationManager(
        {} as any,
        kernel,
        fakeResolutionService(kernel),
      );

      // No version pinned → status-agnostic (existing listing behaviour), no throw.
      expect(m.getSocialIntegrationUnchecked('demo')?.identifier).toBe('demo');
    });
  });

  // ---- Credential resolution (explicit configId BYO > platform env app) ----

  describe('getClientInformation', () => {
    it('returns env app credentials without an orgId (env-only resolution)', async () => {
      stubEnvApp('x');

      const result = await manager.getClientInformation('x');

      expect(result).toEqual({
        client_id: 'x-id',
        client_secret: 'x-secret',
        instanceUrl: '',
        version: 'v1',
      });
      expect(mockOrgPcm.getClientInfo).not.toHaveBeenCalled();
      expect(mockOrgPcm.getClientInfoById).not.toHaveBeenCalled();
    });

    it('returns undefined without an orgId when no env app exists', async () => {
      const result = await manager.getClientInformation('x');

      expect(result).toBeUndefined();
    });

    it('does NOT resolve org credentials without an explicit configId (no primary-config fallback)', async () => {
      stubEnvApp('x');
      mockOrgPcm.getClientInfo.mockResolvedValue({
        client_id: 'org-id',
        client_secret: 'org-secret',
        instanceUrl: '',
      });

      const result = await manager.getClientInformation('x', 'org-1');

      // The by-identifier fallback is gone: the env app wins, the org's
      // primary config is never even queried.
      expect(mockOrgPcm.getClientInfo).not.toHaveBeenCalled();
      expect(mockOrgPcm.getClientInfoById).not.toHaveBeenCalled();
      expect(result).toEqual({
        client_id: 'x-id',
        client_secret: 'x-secret',
        instanceUrl: '',
        version: 'v1',
      });
    });

    it('returns undefined with an orgId, no configId and no env app', async () => {
      const result = await manager.getClientInformation('x', 'org-1');

      expect(mockOrgPcm.getClientInfo).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('still warms the org credential cache without a configId (plug warm path)', async () => {
      await manager.getClientInformation('x', 'org-1');

      expect(mockOrgPcm.ensureFresh).toHaveBeenCalledWith('org-1');
    });

    it('falls back to the env app when the named config resolves no credentials', async () => {
      stubEnvApp('x');
      mockOrgPcm.getClientInfoById.mockResolvedValue(undefined);

      const result = await manager.getClientInformation('x', 'org-1', 'cfg-1');

      expect(result).toEqual({
        client_id: 'x-id',
        client_secret: 'x-secret',
        instanceUrl: '',
        version: 'v1',
      });
    });

    it('uses the named config (configId) credentials when provided', async () => {
      mockOrgPcm.getConfigById.mockResolvedValue({ version: 'v2' } as any);
      mockOrgPcm.getClientInfoById.mockResolvedValue({
        client_id: 'named-id',
        client_secret: 'named-secret',
        instanceUrl: '',
      });

      const result = await manager.getClientInformation('x', 'org-1', 'cfg-1');

      expect(mockOrgPcm.getClientInfoById).toHaveBeenCalledWith('org-1', 'cfg-1');
      expect(mockOrgPcm.getClientInfo).not.toHaveBeenCalled();
      expect(result).toEqual({
        client_id: 'named-id',
        client_secret: 'named-secret',
        instanceUrl: '',
        version: 'v2',
      });
    });

    it('resolves a token-only env app (telegram) without an orgId', async () => {
      stubEnvApp('telegram');

      const result = await manager.getClientInformation('telegram');

      expect(result).toEqual({
        client_id: '',
        client_secret: '',
        instanceUrl: '',
        token: 'telegram-id',
        version: 'v1',
      });
    });

    it('carries the env FACEBOOK_CONFIG_ID through to client information (FBfB)', async () => {
      stubEnvApp('facebook');
      vi.stubEnv('FACEBOOK_CONFIG_ID', 'fb-config-123');

      const result = await manager.getClientInformation('facebook', 'org-1');

      expect(result).toEqual({
        client_id: 'facebook-id',
        client_secret: 'facebook-secret',
        instanceUrl: '',
        configId: 'fb-config-123',
        version: 'v1',
      });
    });
  });

  describe('isProviderEnabled', () => {
    it('returns true when the provider is env-enabled', async () => {
      stubEnvApp('x');

      const result = await manager.isProviderEnabled('x');

      expect(result).toBe(true);
    });

    it('returns true when enabled for the org (enabled = org OR env)', async () => {
      mockOrgPcm.isEnabled.mockResolvedValue(true);

      const result = await manager.isProviderEnabled('x', 'org-1');

      expect(mockOrgPcm.isEnabled).toHaveBeenCalledWith('org-1', 'x');
      expect(result).toBe(true);
    });

    it('returns false when neither org- nor env-enabled', async () => {
      mockOrgPcm.isEnabled.mockResolvedValue(false);

      const result = await manager.isProviderEnabled('discord', 'org-1');

      expect(result).toBe(false);
    });
  });

  // ---- Edge cases: the kernel-sourced social provider catalog ----

  describe('social provider catalog', () => {
    it('contains all expected providers', () => {
      const identifiers = manager.getAllowedSocialsIntegrations();

      expect(identifiers).toContain('x');
      expect(identifiers).toContain('linkedin');
      expect(identifiers).toContain('linkedinpage');
      expect(identifiers).toContain('reddit');
      expect(identifiers).toContain('instagram');
      expect(identifiers).toContain('instagramstandalone');
      expect(identifiers).toContain('facebook');
      expect(identifiers).toContain('threads');
      expect(identifiers).toContain('youtube');
      expect(identifiers).toContain('gmb');
      expect(identifiers).toContain('tiktok');
      expect(identifiers).toContain('pinterest');
      expect(identifiers).toContain('dribbble');
      expect(identifiers).toContain('discord');
      expect(identifiers).toContain('slack');
      expect(identifiers).toContain('kick');
      expect(identifiers).toContain('twitch');
      expect(identifiers).toContain('mastodon');
      expect(identifiers).toContain('bluesky');
      expect(identifiers).toContain('lemmy');
      expect(identifiers).toContain('farcaster');
      expect(identifiers).toContain('telegram');
      expect(identifiers).toContain('nostr');
      expect(identifiers).toContain('vk');
      expect(identifiers).toContain('medium');
      expect(identifiers).toContain('devto');
      expect(identifiers).toContain('hashnode');
      expect(identifiers).toContain('wordpress');
      expect(identifiers).toContain('listmonk');
      expect(identifiers).toContain('moltbook');
      expect(identifiers).toContain('whop');
      expect(identifiers).toContain('skool');
      expect(identifiers).toContain('mewe');
      expect(identifiers).toContain('tumblr');
      expect(identifiers).toContain('pixelfed');
      expect(identifiers).toContain('peertube');
    });
  });

  describe('getSocialProviderCatalog', () => {
    it('returns catalog entries with normalized flags and capabilities from the kernel', async () => {
      const kernelWithCaps = {
        listManifests: (domain?: string) =>
          !domain || domain === 'social'
            ? providerInstances.map((p) => ({
                ...moduleFor(p.identifier)!.manifest,
                capabilities:
                  p.identifier === 'x'
                    ? { analytics: true, comments: true }
                    : {},
              }))
            : [],
        get: (_domain: string, id: string, _version?: string) => moduleFor(id),
        latestActive: (_domain: string, id: string) => moduleFor(id),
      } as any;

      const m = new IntegrationManager(
        {} as any,
        kernelWithCaps,
        fakeResolutionService(kernelWithCaps),
      );

      const catalog = await m.getSocialProviderCatalog();

      expect(catalog.length).toBeGreaterThanOrEqual(36);
      const xEntry = catalog.find((c) => c.identifier === 'x');
      expect(xEntry).toMatchObject({
        identifier: 'x',
        name: 'X',
        description: 'X',
        isExternal: false,
        isWeb3: false,
        isChromeExtension: false,
        customFields: false,
        scopes: '',
        capabilities: { analytics: true, comments: true },
      });

      const telegramEntry = catalog.find((c) => c.identifier === 'telegram');
      expect(telegramEntry?.isWeb3).toBe(true);
      expect(telegramEntry?.customFields).toEqual([
        {
          key: 'bot_token',
          label: 'Bot Token',
          defaultValue: '',
          validation: '^[0-9]+:[a-zA-Z0-9_-]+$',
          type: 'password',
        },
      ]);
    });

    it('returns a catalog even when kernel manifests provide empty capabilities', async () => {
      // The default fakeKernel provides capabilities: {} for every provider, so
      // the method should still produce entries without crashing.
      const catalog = await manager.getSocialProviderCatalog();
      expect(catalog.length).toBeGreaterThanOrEqual(36);
      for (const entry of catalog) {
        expect(entry).toHaveProperty('capabilities');
      }
    });

    it('passes the provider setupDescriptor through as setup', async () => {
      const catalog = await manager.getSocialProviderCatalog();

      const xEntry = catalog.find((c) => c.identifier === 'x');
      expect(xEntry?.setup).toEqual({
        authType: 'oauth1',
        credentialFields: [
          { key: 'clientId', label: 'API Key (Consumer Key)' },
          { key: 'clientSecret', label: 'API Secret (Consumer Secret)', secret: true },
        ],
        portalUrl: 'https://developer.x.com/en/portal/dashboard',
        portalLabel: 'X Developer Portal',
      });
    });

    it('falls back to setup: null for providers without a descriptor', async () => {
      const catalog = await manager.getSocialProviderCatalog();

      const linkedinEntry = catalog.find((c) => c.identifier === 'linkedin');
      expect(linkedinEntry?.setup).toBeNull();
    });

    it('marks env-backed providers as platformConfigured', async () => {
      stubEnvApp('x');

      const catalog = await manager.getSocialProviderCatalog();

      expect(catalog.find((c) => c.identifier === 'x')?.platformConfigured).toBe(true);
      expect(
        catalog.find((c) => c.identifier === 'linkedin')?.platformConfigured
      ).toBe(false);
    });

    it('computes callbackUrl from FRONTEND_URL, stripping a trailing slash', async () => {
      vi.stubEnv('FRONTEND_URL', 'https://app.example.com/');
      try {
        const catalog = await manager.getSocialProviderCatalog();

        const xEntry = catalog.find((c) => c.identifier === 'x');
        expect(xEntry?.callbackUrl).toBe(
          'https://app.example.com/integrations/social/x'
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  // ---- generateAuthUrl: externalUrl dynamic credential merge ----

  describe('generateAuthUrl (externalUrl dynamic registration)', () => {
    const discord = () => providerById.get('discord')!;

    const enabledOrgManager = () => {
      const orgPcm = { isEnabled: vi.fn().mockResolvedValue(true) };
      const m = new IntegrationManager(
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );
      return m;
    };

    let generateAuthUrlSpy: ReturnType<typeof vi.fn>;
    let externalUrlSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      redisStore.clear();
      // The discord mock carries a prototype-level externalUrl; override both
      // hooks per-test on the instance so other describes are unaffected.
      generateAuthUrlSpy = vi.fn(async () => ({
        url: 'https://authorize.example/abc',
        codeVerifier: 'verifier-1',
        state: 'state-1',
      }));
      externalUrlSpy = vi.fn(async () => ({
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
      }));
      discord().generateAuthUrl = generateAuthUrlSpy;
      discord().externalUrl = externalUrlSpy;
    });

    afterEach(() => {
      delete discord().generateAuthUrl;
      delete discord().externalUrl;
    });

    it('merges the dynamic credentials into generateAuthUrl (dynamic wins over static)', async () => {
      const m = enabledOrgManager();

      const result = await m.generateAuthUrl(
        'discord',
        'org-1',
        { client_id: 'static-id', client_secret: 'static-secret' },
        { externalUrl: 'https://mastodon.example' }
      );

      expect(result).toEqual({ url: 'https://authorize.example/abc' });
      expect(generateAuthUrlSpy).toHaveBeenCalledWith({
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://mastodon.example',
      });
    });

    it('normalizes the instance URL before calling the hook and stashing state', async () => {
      const m = enabledOrgManager();

      await m.generateAuthUrl('discord', 'org-1', undefined, {
        externalUrl: 'Mastodon.Example/',
      });

      expect(externalUrlSpy).toHaveBeenCalledWith('https://mastodon.example');
      const stashed = JSON.parse(redisStore.get('external:state-1')!);
      expect(stashed).toEqual({
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://mastodon.example',
      });
      expect(redisStore.get('organization:state-1')).toBe('org-1');
      expect(redisStore.get('login:state-1')).toBe('verifier-1');
    });

    it('rejects an http:// instance URL', async () => {
      const m = enabledOrgManager();

      await expect(
        m.generateAuthUrl('discord', 'org-1', undefined, {
          externalUrl: 'http://mastodon.example',
        })
      ).rejects.toThrow(/https/);
      expect(externalUrlSpy).not.toHaveBeenCalled();
      expect(generateAuthUrlSpy).not.toHaveBeenCalled();
    });

    it('rejects an instance URL with a path', async () => {
      const m = enabledOrgManager();

      await expect(
        m.generateAuthUrl('discord', 'org-1', undefined, {
          externalUrl: 'https://mastodon.example/some/path',
        })
      ).rejects.toThrow(/bare server host/);
      expect(externalUrlSpy).not.toHaveBeenCalled();
    });

    it('throws when the provider requires an external url but none is given', async () => {
      const m = enabledOrgManager();

      await expect(
        m.generateAuthUrl('discord', 'org-1', undefined, {})
      ).rejects.toThrow('Missing external url');
    });

    it('passes static clientInformation through unchanged for non-external providers', async () => {
      const m = enabledOrgManager();
      const xProvider = providerById.get('x')!;
      const spy = vi.fn(async () => ({
        url: 'https://x.example/auth',
        codeVerifier: 'v',
        state: 'state-x',
      }));
      xProvider.generateAuthUrl = spy;
      try {
        await m.generateAuthUrl(
          'x',
          'org-1',
          { client_id: 'static-id', client_secret: 'static-secret' },
          {}
        );
        expect(spy).toHaveBeenCalledWith({
          client_id: 'static-id',
          client_secret: 'static-secret',
        });
      } finally {
        delete xProvider.generateAuthUrl;
      }
    });
  });
});

