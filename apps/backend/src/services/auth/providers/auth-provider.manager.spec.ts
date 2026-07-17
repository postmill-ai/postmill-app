import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthProviderManager } from './auth-provider.manager';

const ORIGINAL_ENV = { ...process.env };

// Every env var the getProviders env fallback can key on. Fallback tests must
// start from a clean slate so developer-machine / CI env cannot leak providers
// into the advertised list.
const PROVIDER_ENV_VARS = [
  'IS_GENERAL',
  'POSTMILL_GENERIC_OAUTH',
  'POSTMILL_OAUTH_CLIENT_ID',
  'POSTMILL_OAUTH_CLIENT_SECRET',
  'POSTMILL_OAUTH_AUTH_URL',
  'POSTMILL_OAUTH_TOKEN_URL',
  'POSTMILL_OAUTH_USERINFO_URL',
  'NEXT_PUBLIC_POSTMILL_OAUTH_DISPLAY_NAME',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'NEYNAR_CLIENT_ID',
  'STRIPE_PUBLISHABLE_KEY',
];

function clearProviderEnv() {
  for (const key of PROVIDER_ENV_VARS) {
    delete process.env[key];
  }
}

function setGenericOauthEnv() {
  process.env.POSTMILL_OAUTH_CLIENT_ID = 'oidc-id';
  process.env.POSTMILL_OAUTH_CLIENT_SECRET = 'oidc-secret';
  process.env.POSTMILL_OAUTH_AUTH_URL = 'https://idp.example.com/authorize';
  process.env.POSTMILL_OAUTH_TOKEN_URL = 'https://idp.example.com/token';
  process.env.POSTMILL_OAUTH_USERINFO_URL = 'https://idp.example.com/userinfo';
}

function makeManager(overrides: {
  kernel?: Partial<{
    latestActive: (...args: any[]) => any;
    versions: (...args: any[]) => any;
    resolveForRead: (...args: any[]) => any;
  }>;
  repo?: Partial<{ list: (...args: any[]) => any }>;
  runtimeContext?: Partial<{ build: (...args: any[]) => any }>;
}) {
  const kernel = {
    latestActive: vi.fn().mockReturnValue(undefined),
    versions: vi.fn().mockReturnValue([]),
    resolveForRead: vi.fn().mockReturnValue({
      create: vi.fn().mockReturnValue({ mocked: 'provider' }),
    }),
    ...overrides.kernel,
  };

  const repo = {
    list: vi.fn().mockResolvedValue([]),
    ...overrides.repo,
  };

  const runtimeContext = {
    build: vi.fn().mockReturnValue({ mocked: 'ctx' }),
    ...overrides.runtimeContext,
  };

  const manager = new AuthProviderManager(
    kernel as any,
    runtimeContext as any,
    repo as any
  );

  return { manager, kernel, repo, runtimeContext };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('AuthProviderManager', () => {
  describe('getProviders', () => {
    it('returns enabled DB providers when at least one is configured', async () => {
      const { manager, kernel, repo } = makeManager({
        repo: {
          list: vi.fn().mockResolvedValue([
            {
              provider: 'GOOGLE',
              enabled: true,
              displayName: 'Workspace SSO',
            },
            { provider: 'GITHUB', enabled: false, displayName: null },
            { provider: 'GENERIC', enabled: true, displayName: null },
          ]),
        },
        kernel: {
          latestActive: vi.fn().mockReturnValue({
            manifest: { version: 'v2', status: 'active' },
          }),
        },
      });

      const result = await manager.getProviders();

      expect(repo.list).toHaveBeenCalled();
      expect(result.providers).toEqual([
        { provider: 'GOOGLE', displayName: 'Workspace SSO', version: 'v2', status: 'active' },
        { provider: 'GENERIC', displayName: 'OIDC', version: 'v2', status: 'active' },
      ]);
    });

    it('falls back to LOCAL only when no DB config and no platform env credentials exist', async () => {
      clearProviderEnv();
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers).toEqual([
        { provider: 'LOCAL', displayName: 'Email', version: 'v1', status: 'active' },
      ]);
    });

    it('never keys on IS_GENERAL: the hosted flag without credentials still yields LOCAL only', async () => {
      clearProviderEnv();
      process.env.IS_GENERAL = 'true';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual(['LOCAL']);
    });

    it('does not advertise GOOGLE when only YOUTUBE_CLIENT_ID is set without its secret (half-config)', async () => {
      clearProviderEnv();
      process.env.YOUTUBE_CLIENT_ID = 'yt-id';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual(['LOCAL']);
    });

    it('advertises GOOGLE when both YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are set', async () => {
      clearProviderEnv();
      process.env.YOUTUBE_CLIENT_ID = 'yt-id';
      process.env.YOUTUBE_CLIENT_SECRET = 'yt-secret';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual([
        'LOCAL',
        'GOOGLE',
      ]);
    });

    it('advertises GITHUB when both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set', async () => {
      clearProviderEnv();
      process.env.GITHUB_CLIENT_ID = 'gh-id';
      process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual([
        'LOCAL',
        'GITHUB',
      ]);
    });

    it('does not advertise GITHUB when only GITHUB_CLIENT_ID is set without its secret (half-config)', async () => {
      clearProviderEnv();
      process.env.GITHUB_CLIENT_ID = 'gh-id';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual(['LOCAL']);
    });

    it('does not advertise GENERIC when POSTMILL_GENERIC_OAUTH is the shipped string "false"', async () => {
      clearProviderEnv();
      // .env.example ships POSTMILL_GENERIC_OAUTH="false" — a truthy string
      // that must still disable OIDC, even with the POSTMILL_OAUTH_* set present.
      process.env.POSTMILL_GENERIC_OAUTH = 'false';
      setGenericOauthEnv();
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual(['LOCAL']);
    });

    it('does not advertise GENERIC when the toggle is "true" but the POSTMILL_OAUTH_* set is incomplete', async () => {
      clearProviderEnv();
      process.env.POSTMILL_GENERIC_OAUTH = 'true';
      process.env.POSTMILL_OAUTH_CLIENT_ID = 'oidc-id';
      // missing POSTMILL_OAUTH_CLIENT_SECRET / AUTH_URL / TOKEN_URL / USERINFO_URL
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual(['LOCAL']);
    });

    it('advertises GENERIC when the toggle is "true" and the full POSTMILL_OAUTH_* set is present', async () => {
      clearProviderEnv();
      process.env.POSTMILL_GENERIC_OAUTH = 'true';
      setGenericOauthEnv();
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers).toEqual([
        { provider: 'LOCAL', displayName: 'Email', version: 'v1', status: 'active' },
        { provider: 'GENERIC', displayName: 'OIDC', version: 'v1', status: 'active' },
      ]);
    });

    it('keeps the Farcaster/Wallet env gates (NEYNAR_CLIENT_ID / STRIPE_PUBLISHABLE_KEY)', async () => {
      clearProviderEnv();
      process.env.NEYNAR_CLIENT_ID = 'neynar-id';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
      const { manager } = makeManager({});

      const result = await manager.getProviders();

      expect(result.providers.map((p: any) => p.provider)).toEqual([
        'LOCAL',
        'FARCASTER',
        'WALLET',
      ]);
    });

    it('uses DEFAULT_VERSION/active when the kernel has no manifest for a provider', async () => {
      clearProviderEnv();
      process.env.GITHUB_CLIENT_ID = 'gh-id';
      process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
      const { manager } = makeManager({
        kernel: {
          latestActive: vi.fn().mockReturnValue(undefined),
          versions: vi.fn().mockReturnValue([]),
        },
      });

      const result = await manager.getProviders();

      expect(result.providers).toEqual([
        { provider: 'LOCAL', displayName: 'Email', version: 'v1', status: 'active' },
        { provider: 'GITHUB', displayName: 'GitHub', version: 'v1', status: 'active' },
      ]);
    });
  });

  describe('getProvider', () => {
    it('resolves the kernel module, normalises the id to lowercase, and forwards repo + redis', () => {
      const { manager, kernel, runtimeContext, repo } = makeManager({});

      const provider = manager.getProvider('GITHUB');

      expect(kernel.resolveForRead).toHaveBeenCalledWith('auth', 'github', 'v1');
      expect(runtimeContext.build).toHaveBeenCalledWith({
        extras: { authProviderRepo: repo, redis: expect.anything() },
      });
      expect(provider).toEqual({ mocked: 'provider' });
    });

    it('respects an explicit version', () => {
      const { manager, kernel } = makeManager({});

      manager.getProvider('GOOGLE', 'v2');

      expect(kernel.resolveForRead).toHaveBeenCalledWith('auth', 'google', 'v2');
    });
  });
});
