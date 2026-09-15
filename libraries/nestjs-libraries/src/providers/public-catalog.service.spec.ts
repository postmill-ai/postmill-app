import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PublicCatalogService,
  publicProviderIconPath,
  isPublicCatalogDomain,
} from './public-catalog.service';

const entry = (over: Record<string, unknown>) => ({
  domain: 'ai',
  providerId: 'openai',
  version: 'v1',
  displayName: 'OpenAI',
  status: 'active',
  verified: true,
  capabilities: { text: true, image: true, vision: false },
  authType: 'apiKey',
  defaultDomain: null,
  setupNotes: 'secret setup notes',
  credentialFields: [{ key: 'apiKey' }],
  deprecatedAt: null,
  sunsetAt: null,
  description: { en: 'OpenAI models' },
  website: 'https://openai.com',
  mediaCategories: undefined,
  kind: 'direct',
  featured: false,
  featuredSortOrder: null,
  ...over,
});

const social = (over: Record<string, unknown>) => ({
  identifier: 'x',
  name: 'X',
  editor: 'normal',
  setupDescriptor: { authType: 'oauth1' },
  commentsCapabilities: { read: true, reply: true, like: false },
  mention: () => Promise.resolve([]),
  ...over,
});

describe('PublicCatalogService', () => {
  let catalog: { buildCatalog: ReturnType<typeof vi.fn> };
  let manager: { getSocialProviders: ReturnType<typeof vi.fn>; getAllPlugs: ReturnType<typeof vi.fn> };
  let kernel: { get: ReturnType<typeof vi.fn> };
  let service: PublicCatalogService;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com/';
    catalog = { buildCatalog: vi.fn().mockResolvedValue([]) };
    manager = {
      getSocialProviders: vi.fn().mockReturnValue([]),
      getAllPlugs: vi.fn().mockReturnValue([]),
    };
    // AI adapters: openai is a direct API even though its shared metadata says hub
    kernel = {
      get: vi.fn((domain: string, id: string) =>
        domain === 'ai' && id === 'openai' ? { create: () => ({ type: 'direct' }) } : undefined,
      ),
    };
    const ctxFactory = { build: () => ({}) };
    service = new PublicCatalogService(catalog as any, manager as any, kernel as any, ctxFactory as any);
  });
  afterEach(() => vi.useRealTimers());

  it('exposes only the public domains, labelled, with counts and a capability legend', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({}),
      entry({ providerId: 'anthropic', displayName: 'Anthropic', capabilities: { text: true, tools: true } }),
      entry({ domain: 'email', providerId: 'resend', displayName: 'Resend' }),
      entry({ domain: 'auth', providerId: 'github', displayName: 'GitHub' }),
    ]);
    const out = await service.build();
    expect(out.domains.map((d) => d.id)).toEqual([
      'social', 'comms', 'ai', 'media', 'storage', 'shortlink', 'vpn',
    ]);
    const ai = out.domains.find((d) => d.id === 'ai')!;
    expect(ai.label).toBe('LLM providers');
    expect(ai.count).toBe(2);
    expect(ai.providers.map((p) => p.id)).toEqual(['anthropic', 'openai']);
    expect(ai.capabilityKeys).toEqual(['text', 'tools', 'image']);
    expect(out.total).toBe(2);
    expect(out.generatedAt).toMatch(/^\d{4}-/);
  });

  it('strips deployment-fingerprinting fields and keeps only true capability flags', async () => {
    catalog.buildCatalog.mockResolvedValue([entry({ featured: true, featuredSortOrder: 2, kind: 'hub' })]);
    const [p] = (await service.build('ai')).domains[0].providers;
    expect(p).toEqual({
      id: 'openai',
      domain: 'ai',
      name: 'OpenAI',
      icon: 'https://app.example.com/icons/providers/openai.svg',
      capabilities: ['text', 'image'],
      beta: false,
      featured: true,
      featuredSortOrder: 2,
      description: { en: 'OpenAI models' },
      website: 'https://openai.com',
      kind: 'direct',
    });
    expect(JSON.stringify(p)).not.toMatch(/version|status|credentialFields|setupNotes|secret/);
  });

  it('takes the AI kind from the adapter type, falling back to metadata', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({ kind: 'hub' }), // openai: metadata says hub (media sense), adapter says direct
      entry({ providerId: 'openrouter', displayName: 'OpenRouter', kind: 'hub' }), // no adapter stub → metadata
      entry({ domain: 'media', providerId: 'openai', kind: 'hub', capabilities: { image: true } }),
    ]);
    const out = await service.build();
    const ai = out.domains.find((d) => d.id === 'ai')!.providers;
    expect(ai.find((p) => p.id === 'openai')!.kind).toBe('direct');
    expect(ai.find((p) => p.id === 'openrouter')!.kind).toBe('hub');
    expect(out.domains.find((d) => d.id === 'media')!.providers[0].kind).toBe('hub');
    expect(kernel.get).toHaveBeenCalledWith('ai', 'openai', 'v1');
  });

  it('skips retired versions and keeps the healthiest status per provider', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({ version: 'v1', status: 'deprecated', displayName: 'Old' }),
      entry({ version: 'v2', status: 'active', displayName: 'New' }),
      entry({ providerId: 'gone', status: 'retired', displayName: 'Gone' }),
    ]);
    const ai = (await service.build('ai')).domains[0];
    expect(ai.providers.map((p) => p.name)).toEqual(['New']);
  });

  it('adds channel-only facts from the raw social adapters and collapses newline names', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({
        domain: 'social',
        providerId: 'x',
        displayName: 'X',
        capabilities: { analytics: true, comments: true, maxMedia: 4, poll: false },
        kind: null,
      }),
      entry({
        domain: 'social',
        providerId: 'instagram-standalone',
        displayName: 'Instagram\n(Standalone)',
        capabilities: { maxMedia: 10 },
        verified: false,
        kind: null,
      }),
    ]);
    manager.getSocialProviders.mockReturnValue([
      social({}),
      social({
        identifier: 'instagram-standalone',
        editor: 'none',
        setupDescriptor: undefined,
        commentsCapabilities: undefined,
        mention: undefined,
        externalUrl: () => Promise.resolve({}),
        isWeb3: true,
      }),
    ]);
    manager.getAllPlugs.mockReturnValue([{ identifier: 'x', plugs: [{}] }]);

    const { providers } = (await service.build('social')).domains[0];
    const x = providers.find((p) => p.id === 'x')!;
    expect(x).toMatchObject({
      capabilities: ['analytics', 'comments'],
      maxMedia: 4,
      editor: 'normal',
      authType: 'oauth1',
      selfHosted: false,
      web3: false,
      chromeExtension: false,
      comments: { read: true, reply: true, like: false },
      mentions: true,
      autoPlugs: true,
      icon: 'https://app.example.com/icons/platforms/x.png',
    });
    expect(x).not.toHaveProperty('kind');
    const ig = providers.find((p) => p.id === 'instagram-standalone')!;
    expect(ig.name).toBe('Instagram (Standalone)');
    expect(ig.beta).toBe(true);
    expect(ig).toMatchObject({ editor: 'none', selfHosted: true, web3: true, mentions: false, autoPlugs: false });
    expect(ig).not.toHaveProperty('authType');
    expect(ig).not.toHaveProperty('comments');
  });

  it('does not leak channel facts onto a comms app that shares the provider id', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({ domain: 'comms', providerId: 'slack', displayName: 'Slack', capabilities: { threads: true }, kind: null }),
    ]);
    manager.getSocialProviders.mockReturnValue([social({ identifier: 'slack', name: 'Slack' })]);
    const [slack] = (await service.build()).domains.find((d) => d.id === 'comms')!.providers;
    expect(slack.capabilities).toEqual(['threads']);
    expect(slack.icon).toBe('https://app.example.com/icons/platforms/slack.png');
    expect(slack).not.toHaveProperty('editor');
    expect(slack).not.toHaveProperty('comments');
  });

  it('labels storage by hosting kind and media by categories', async () => {
    catalog.buildCatalog.mockResolvedValue([
      entry({ domain: 'storage', providerId: 'local', displayName: 'Local', capabilities: {}, kind: null }),
      entry({ domain: 'storage', providerId: 'medialocker', displayName: 'MediaLocker', capabilities: {}, kind: null }),
      entry({ domain: 'storage', providerId: 'backblaze_b2', displayName: 'Backblaze B2', capabilities: {}, kind: null }),
      entry({ domain: 'media', providerId: 'heygen', displayName: 'HeyGen', capabilities: { video: true }, kind: 'action', mediaCategories: ['video-avatar'] }),
    ]);
    const out = await service.build();
    const storage = out.domains.find((d) => d.id === 'storage')!.providers;
    expect(storage.map((p) => [p.id, p.storageKind])).toEqual([
      ['backblaze_b2', 's3-compatible'],
      ['local', 'built-in'],
      ['medialocker', 'proprietary'],
    ]);
    expect(storage[0].icon).toBe('https://app.example.com/icons/providers/backblaze_b2.svg');
    const heygen = out.domains.find((d) => d.id === 'media')!.providers[0];
    expect(heygen).toMatchObject({ kind: 'action', mediaCategories: ['video-avatar'] });
  });

  it('memoises the assembled catalogue for a minute per filter', async () => {
    vi.useFakeTimers();
    await service.build();
    await service.build();
    await service.build('ai');
    expect(catalog.buildCatalog).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(61_000);
    await service.build();
    expect(catalog.buildCatalog).toHaveBeenCalledTimes(3);
  });
});

describe('publicProviderIconPath', () => {
  it('shares the platform PNG set between channels and comms apps, youtube being the one SVG', () => {
    expect(publicProviderIconPath('social', 'x')).toBe('/icons/platforms/x.png');
    expect(publicProviderIconPath('comms', 'slack')).toBe('/icons/platforms/slack.png');
    expect(publicProviderIconPath('social', 'youtube')).toBe('/icons/platforms/youtube.svg');
    expect(publicProviderIconPath('vpn', 'nordvpn')).toBe('/icons/providers/nordvpn.svg');
  });
  it('recognises public domains only', () => {
    expect(isPublicCatalogDomain('social')).toBe(true);
    expect(isPublicCatalogDomain('email')).toBe(false);
    expect(isPublicCatalogDomain(undefined)).toBe(false);
  });
});
