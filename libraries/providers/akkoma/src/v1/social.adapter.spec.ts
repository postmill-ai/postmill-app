import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AkkomaProvider } from './social.adapter';
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

describe('AkkomaProvider (Mastodon-API family subclass)', () => {
  let provider: AkkomaProvider;

  beforeEach(() => {
    provider = new AkkomaProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('akkoma');
    expect(provider.name).toBe('Akkoma');
    expect(provider.maxLength()).toBe(5000);
  });

  it('registers the app with an akkoma-scoped OAuth callback', async () => {
    safeFetchMock.mockResolvedValue(
      jsonResponse({ client_id: 'dyn-id', client_secret: 'dyn-secret' })
    );

    await provider.externalUrl('akkoma.example');

    const [, init] = safeFetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.redirect_uris).toBe(
      'https://app.postmill.example/integrations/social/akkoma'
    );
  });

  it('builds the authorize URL with an akkoma-scoped redirect_uri', async () => {
    const { url } = await provider.generateAuthUrl({
      client_id: 'dyn-id',
      client_secret: 'dyn-secret',
      instanceUrl: 'https://akkoma.example',
    });

    expect(url).toContain('https://akkoma.example/oauth/authorize');
    expect(url).toContain(
      `redirect_uri=${encodeURIComponent(
        'https://app.postmill.example/integrations/social/akkoma'
      )}`
    );
  });
});
