import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('@gitroom/nestjs-libraries/integrations/social/x.provider', () => ({
  XProvider: createMockProvider('x', 'X', {
    extensionCookies: [{ name: 'auth_token', domain: 'x.com' }],
  }),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/linkedin.provider', () => ({
  LinkedinProvider: createMockProvider('linkedin', 'LinkedIn'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider', () => ({
  LinkedinPageProvider: createMockProvider('linkedinpage', 'LinkedIn Page'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/reddit.provider', () => ({
  RedditProvider: createMockProvider('reddit', 'Reddit'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/instagram.provider', () => ({
  InstagramProvider: createMockProvider('instagram', 'Instagram'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider', () => ({
  InstagramStandaloneProvider: createMockProvider('instagramstandalone', 'Instagram Standalone'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/facebook.provider', () => ({
  FacebookProvider: createMockProvider('facebook', 'Facebook'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/threads.provider', () => ({
  ThreadsProvider: createMockProvider('threads', 'Threads'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/youtube.provider', () => ({
  YoutubeProvider: createMockProvider('youtube', 'YouTube'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/gmb.provider', () => ({
  GmbProvider: createMockProvider('gmb', 'GMB'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/tiktok.provider', () => ({
  TiktokProvider: createMockProvider('tiktok', 'TikTok'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/pinterest.provider', () => ({
  PinterestProvider: createMockProvider('pinterest', 'Pinterest'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/dribbble.provider', () => ({
  DribbbleProvider: createMockProvider('dribbble', 'Dribbble'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/discord.provider', () => ({
  DiscordProvider: createMockProvider('discord', 'Discord', {
    externalUrl: async () => ({ client_id: 'd_id', client_secret: 'd_secret' }),
  }),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/slack.provider', () => ({
  SlackProvider: createMockProvider('slack', 'Slack'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/kick.provider', () => ({
  KickProvider: createMockProvider('kick', 'Kick'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/twitch.provider', () => ({
  TwitchProvider: createMockProvider('twitch', 'Twitch'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/mastodon.provider', () => ({
  MastodonProvider: createMockProvider('mastodon', 'Mastodon'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/bluesky.provider', () => ({
  BlueskyProvider: createMockProvider('bluesky', 'Bluesky'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/lemmy.provider', () => ({
  LemmyProvider: createMockProvider('lemmy', 'Lemmy'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/farcaster.provider', () => ({
  FarcasterProvider: createMockProvider('farcaster', 'Farcaster'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/telegram.provider', () => ({
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

vi.mock('@gitroom/nestjs-libraries/integrations/social/nostr.provider', () => ({
  NostrProvider: createMockProvider('nostr', 'Nostr'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/vk.provider', () => ({
  VkProvider: createMockProvider('vk', 'VK'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/medium.provider', () => ({
  MediumProvider: createMockProvider('medium', 'Medium'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/dev.to.provider', () => ({
  DevToProvider: createMockProvider('devto', 'DevTo'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/hashnode.provider', () => ({
  HashnodeProvider: createMockProvider('hashnode', 'Hashnode'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/wordpress.provider', () => ({
  WordpressProvider: createMockProvider('wordpress', 'WordPress'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/listmonk.provider', () => ({
  ListmonkProvider: createMockProvider('listmonk', 'Listmonk'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/moltbook.provider', () => ({
  MoltbookProvider: createMockProvider('moltbook', 'Moltbook'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/whop.provider', () => ({
  WhopProvider: createMockProvider('whop', 'Whop'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/skool.provider', () => ({
  SkoolProvider: createMockProvider('skool', 'Skool'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/mewe.provider', () => ({
  MeweProvider: createMockProvider('mewe', 'MeWe'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/tumblr.provider', () => ({
  TumblrProvider: createMockProvider('tumblr', 'Tumblr'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/pixelfed.provider', () => ({
  PixelfedProvider: createMockProvider('pixelfed', 'Pixelfed'),
}));

vi.mock('@gitroom/nestjs-libraries/integrations/social/peertube.provider', () => ({
  PeerTubeProvider: createMockProvider('peertube', 'PeerTube'),
}));

// Mock SocialAbstract to avoid pulling in sharp, temporalio, etc.
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
}));

// IntegrationManager injects the ProviderKernel DI token from providers.module;
// stub the module so this spec doesn't pull in the kernel's heavy provider graph
// (the manager is constructed manually with a fake kernel below).
vi.mock('@gitroom/nestjs-libraries/providers/providers.module', () => ({
  PROVIDER_KERNEL: Symbol('ProviderKernel'),
}));

// ---------------------------------------------------------------------------
// Now it's safe to import the real module under test.
// ---------------------------------------------------------------------------
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// Populate the registry with the mock providers (mirrors the pre-7.5.1 static
// list, which the now-stubbed registration module would otherwise have filled).
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';
import { RedditProvider } from '@gitroom/nestjs-libraries/integrations/social/reddit.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { ThreadsProvider } from '@gitroom/nestjs-libraries/integrations/social/threads.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import { GmbProvider } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { PinterestProvider } from '@gitroom/nestjs-libraries/integrations/social/pinterest.provider';
import { DribbbleProvider } from '@gitroom/nestjs-libraries/integrations/social/dribbble.provider';
import { DiscordProvider } from '@gitroom/nestjs-libraries/integrations/social/discord.provider';
import { SlackProvider } from '@gitroom/nestjs-libraries/integrations/social/slack.provider';
import { KickProvider } from '@gitroom/nestjs-libraries/integrations/social/kick.provider';
import { TwitchProvider } from '@gitroom/nestjs-libraries/integrations/social/twitch.provider';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { BlueskyProvider } from '@gitroom/nestjs-libraries/integrations/social/bluesky.provider';
import { LemmyProvider } from '@gitroom/nestjs-libraries/integrations/social/lemmy.provider';
import { FarcasterProvider } from '@gitroom/nestjs-libraries/integrations/social/farcaster.provider';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { NostrProvider } from '@gitroom/nestjs-libraries/integrations/social/nostr.provider';
import { VkProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.provider';
import { MediumProvider } from '@gitroom/nestjs-libraries/integrations/social/medium.provider';
import { DevToProvider } from '@gitroom/nestjs-libraries/integrations/social/dev.to.provider';
import { HashnodeProvider } from '@gitroom/nestjs-libraries/integrations/social/hashnode.provider';
import { WordpressProvider } from '@gitroom/nestjs-libraries/integrations/social/wordpress.provider';
import { ListmonkProvider } from '@gitroom/nestjs-libraries/integrations/social/listmonk.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import { WhopProvider } from '@gitroom/nestjs-libraries/integrations/social/whop.provider';
import { SkoolProvider } from '@gitroom/nestjs-libraries/integrations/social/skool.provider';
import { MeweProvider } from '@gitroom/nestjs-libraries/integrations/social/mewe.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { PixelfedProvider } from '@gitroom/nestjs-libraries/integrations/social/pixelfed.provider';
import { PeerTubeProvider } from '@gitroom/nestjs-libraries/integrations/social/peertube.provider';

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
  let mockPcm: {
    getEnabledIdentifiers: ReturnType<typeof vi.fn>;
    getAllConfigs: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
    getClientInfo: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
    ensureFresh: ReturnType<typeof vi.fn>;
  };
  let manager: IntegrationManager;

  beforeEach(() => {
    mockPcm = {
      getEnabledIdentifiers: vi.fn(),
      getAllConfigs: vi.fn(),
      getConfig: vi.fn(),
      getClientInfo: vi.fn(),
      isEnabled: vi.fn(),
      ensureFresh: vi.fn(),
    };
    manager = new IntegrationManager(
      mockPcm as any,
      {} as any,
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

  // ---- getAllIntegrations ----

  describe('getAllIntegrations', () => {
    it('returns all providers when no DB configs exist (hasAnyConfigs = false)', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue([]);
      mockPcm.getAllConfigs.mockResolvedValue([]);

      const result = await manager.getAllIntegrations();

      expect(result.article).toEqual([]);
      // all 33 social providers should be returned
      expect(result.social.length).toBeGreaterThanOrEqual(36);
      expect(result.social.map((s: any) => s.identifier)).toContain('x');
      expect(result.social.map((s: any) => s.identifier)).toContain('telegram');
    });

    it('filters to enabled providers when DB configs exist', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['x', 'linkedin']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
        { identifier: 'linkedin', enabled: true } as any,
        { identifier: 'discord', enabled: false } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations();

      expect(result.social).toHaveLength(2);
      expect(result.social[0].identifier).toBe('x');
      expect(result.social[1].identifier).toBe('linkedin');
    });

    it('includes setupInstructions when config has them', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue({
        identifier: 'x',
        setupInstructions: 'Follow these steps...',
      } as any);

      const result = await manager.getAllIntegrations();

      expect(result.social[0].setupInstructions).toBe('Follow these steps...');
    });

    it('omits setupInstructions when config has none', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['linkedin']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'linkedin', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue({
        identifier: 'linkedin',
      } as any);

      const result = await manager.getAllIntegrations();

      expect(result.social[0].setupInstructions).toBeUndefined();
    });

    it('omits setupInstructions when config is undefined', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations();

      expect(result.social[0].setupInstructions).toBeUndefined();
    });

    it('includes extensionCookies when provider has them', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['x']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'x', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations();

      expect(result.social[0].extensionCookies).toEqual([
        { name: 'auth_token', domain: 'x.com' },
      ]);
    });

    it('includes customFields when provider has them', async () => {
      mockPcm.getEnabledIdentifiers.mockResolvedValue(['telegram']);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'telegram', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations();

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
      mockPcm.getEnabledIdentifiers.mockResolvedValue([
        'discord',
        'telegram',
      ]);
      mockPcm.getAllConfigs.mockResolvedValue([
        { identifier: 'discord', enabled: true } as any,
        { identifier: 'telegram', enabled: true } as any,
      ]);
      mockPcm.getConfig.mockResolvedValue(undefined);

      const result = await manager.getAllIntegrations();

      const discord = result.social.find((s: any) => s.identifier === 'discord');
      expect(discord.isExternal).toBe(true);
      expect(discord.isWeb3).toBe(false);

      const telegram = result.social.find(
        (s: any) => s.identifier === 'telegram'
      );
      expect(telegram.isWeb3).toBe(true);
      expect(telegram.isChromeExtension).toBe(false);
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
    it('returns internal plugs for a known provider', async () => {
      mockPcm.isEnabled.mockResolvedValue(true);

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

    it('filters out disabled internal plugs', async () => {
      mockPcm.isEnabled.mockResolvedValue(true);

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
      mockPcm.isEnabled.mockResolvedValue(true);

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

    it('throws NotFoundException when isEnabled returns false', async () => {
      mockPcm.isEnabled.mockResolvedValue(false);

      await expect(
        manager.getInternalPlugs('x')
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
    it('returns the provider for a known identifier', async () => {
      mockPcm.isEnabled.mockResolvedValue(true);

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

    it('throws NotFoundException when isEnabled returns false', async () => {
      mockPcm.isEnabled.mockResolvedValue(false);

      await expect(
        manager.getSocialIntegration('x')
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getSocialIntegrationUnchecked ----

  describe('getSocialIntegrationUnchecked', () => {
    it('returns the provider for a known identifier without checking enabled state', () => {
      const provider = manager.getSocialIntegrationUnchecked('x');

      expect(provider).toBeDefined();
      expect(provider?.identifier).toBe('x');
      expect(mockPcm.isEnabled).not.toHaveBeenCalled();
    });

    it('returns the provider even when it is disabled', () => {
      mockPcm.isEnabled.mockResolvedValue(false);

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
      const globalPcm = { isEnabled: vi.fn().mockResolvedValue(false) };
      const m = new IntegrationManager(
        globalPcm as any,
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );

      const provider = await m.getSocialIntegration('x', 'org-1');

      expect(provider.identifier).toBe('x');
      expect(orgPcm.isEnabled).toHaveBeenCalledWith('org-1', 'x');
    });

    it('throws when the same org-only provider is resolved without an orgId (no global/env)', async () => {
      const orgPcm = { isEnabled: vi.fn().mockResolvedValue(true) };
      const globalPcm = { isEnabled: vi.fn().mockResolvedValue(false) };
      const m = new IntegrationManager(
        globalPcm as any,
        orgPcm as any,
        fakeKernel,
        fakeResolutionService(fakeKernel),
      );

      await expect(m.getSocialIntegration('x')).rejects.toThrow(NotFoundException);
      expect(orgPcm.isEnabled).not.toHaveBeenCalled();
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
        {} as any,
        kernel,
        fakeResolutionService(kernel),
      );

      // No version pinned → status-agnostic (existing listing behaviour), no throw.
      expect(m.getSocialIntegrationUnchecked('demo')?.identifier).toBe('demo');
    });
  });

  // ---- Delegation methods ----

  describe('getClientInformation', () => {
    it('delegates to ProviderConfigManager.getClientInfo', async () => {
      mockPcm.getClientInfo.mockResolvedValue({
        client_id: 'cid',
        client_secret: 'cs',
        instanceUrl: 'https://example.com',
      });

      const result = await manager.getClientInformation('x');

      expect(mockPcm.getClientInfo).toHaveBeenCalledWith('x');
      expect(result).toEqual({
        client_id: 'cid',
        client_secret: 'cs',
        instanceUrl: 'https://example.com',
        version: 'v1',
      });
    });
  });

  describe('isProviderEnabled', () => {
    it('delegates to ProviderConfigManager.isEnabled', async () => {
      mockPcm.isEnabled.mockResolvedValue(true);

      const result = await manager.isProviderEnabled('x');

      expect(mockPcm.isEnabled).toHaveBeenCalledWith('x');
      expect(result).toBe(true);
    });

    it('returns false when ProviderConfigManager returns false', async () => {
      mockPcm.isEnabled.mockResolvedValue(false);

      const result = await manager.isProviderEnabled('discord');

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
  });
});
