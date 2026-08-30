import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FriendicaProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const safeFetchMock = vi.fn();
const undiciFetchMock = vi.fn();

setSocialFetchPorts({
  safeFetch: safeFetchMock,
  undiciFetch: undiciFetchMock,
  ssrfSafeDispatcher: {},
  getVpnDispatcher: () => undefined,
  isSafePublicHttpsUrl: async () => true,
  RefreshTokenError: class extends Error {},
  BadBodyError: class extends Error {},
  timer: async () => undefined,
  sharp: vi.fn(),
  readOrFetch: async () => Buffer.from(''),
} as any);

const jsonResponse = (body: any, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

describe('FriendicaProvider (Mastodon-API family subclass)', () => {
  let provider: FriendicaProvider;

  beforeEach(() => {
    provider = new FriendicaProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('friendica');
    expect(provider.name).toBe('Friendica');
    expect(provider.maxLength()).toBe(5000);
  });

  it('registers the app with a friendica-scoped OAuth callback', async () => {
    safeFetchMock.mockResolvedValue(
      jsonResponse({ client_id: 'dyn-id', client_secret: 'dyn-secret' })
    );

    await provider.externalUrl('friendica.example');

    const [, init] = safeFetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.redirect_uris).toBe(
      'https://app.postmill.example/integrations/social/friendica'
    );
  });

  it('builds the authorize URL with a friendica-scoped redirect_uri', async () => {
    const { url } = await provider.generateAuthUrl({
      client_id: 'dyn-id',
      client_secret: 'dyn-secret',
      instanceUrl: 'https://friendica.example',
    });

    expect(url).toContain('https://friendica.example/oauth/authorize');
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent(
        'https://app.postmill.example/integrations/social/friendica'
      )}`
    );
  });
});
