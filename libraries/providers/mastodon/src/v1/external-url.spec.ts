import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pass-through crypto so customInstanceDetails fixtures read as plain JSON.
vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `encrypted:${value}`),
    fixedDecryption: vi.fn((value: string) =>
      value.startsWith('encrypted:') ? value.slice('encrypted:'.length) : value
    ),
  },
}));

import { MastodonProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

const safeFetchMock = vi.fn();
const undiciFetchMock = vi.fn();

// The user-influenced instance URL must travel via the kernel safeFetch port —
// these tests inject a mocked port and assert it is the one being called.
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

describe('MastodonProvider.externalUrl (dynamic client registration)', () => {
  let provider: MastodonProvider;

  beforeEach(() => {
    provider = new MastodonProvider();
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.postmill.example');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers the app on the normalized instance and returns its credentials', async () => {
    safeFetchMock.mockResolvedValue(
      jsonResponse({ client_id: 'dyn-id', client_secret: 'dyn-secret' })
    );

    const result = await provider.externalUrl('Mastodon.Example/');

    expect(result).toEqual({ client_id: 'dyn-id', client_secret: 'dyn-secret' });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(url).toBe('https://mastodon.example/api/v1/apps');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      client_name: 'Postmill',
      redirect_uris: 'https://app.postmill.example/integrations/social/mastodon',
      // Mastodon's /api/v1/apps takes the scope list space-separated.
      scopes:
        'read:statuses read:accounts write:statuses write:favourites profile write:media',
      website: 'https://app.postmill.example',
    });
  });

  it('throws a clear error when the instance rejects the registration', async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 422));

    await expect(
      provider.externalUrl('https://mastodon.example')
    ).rejects.toThrow(/HTTP 422/);
  });

  it('throws when the response carries no credentials', async () => {
    safeFetchMock.mockResolvedValue(jsonResponse({}));

    await expect(
      provider.externalUrl('https://mastodon.example')
    ).rejects.toThrow(/did not return OAuth app credentials/);
  });

  it.each([
    'http://mastodon.example',
    'https://mastodon.example/some/path',
    'https://user:pass@mastodon.example',
    'https://mastodon.example/?x=1',
  ])('rejects invalid instance URL %s before any outbound call', async (url) => {
    await expect(provider.externalUrl(url)).rejects.toThrow();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe('MastodonProvider per-integration instance resolution', () => {
  let provider: MastodonProvider;

  beforeEach(() => {
    provider = new MastodonProvider();
    vi.clearAllMocks();
  });

  const postDetails = [
    { id: 'p1', message: 'hello fediverse', settings: {}, media: [] },
  ] as any;

  it('posts to the instance stored (encrypted) on the integration, not mastodon.social', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ id: 'post-1' }));
    const integration = {
      customInstanceDetails: `encrypted:${JSON.stringify({
        client_id: 'dyn-id',
        client_secret: 'dyn-secret',
        instanceUrl: 'https://kolektiva.social',
      })}`,
    } as any;

    const result = await provider.post(
      'acct-1',
      'token-1',
      postDetails,
      integration,
      // Even a conflicting org-level instanceUrl must lose to the stored one.
      { client_id: 'x', client_secret: 'y', instanceUrl: 'https://mastodon.social' }
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://kolektiva.social/api/v1/statuses',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result[0].releaseURL).toBe('https://kolektiva.social/statuses/post-1');
  });

  it('falls back to mastodon.social when the integration carries no instance details', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ id: 'post-2' }));

    const result = await provider.post(
      'acct-1',
      'token-1',
      postDetails,
      {} as any,
      undefined
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://mastodon.social/api/v1/statuses',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result[0].releaseURL).toBe('https://mastodon.social/statuses/post-2');
  });

  it('ignores undecryptable / foreign customInstanceDetails blobs', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ id: 'post-3' }));
    const integration = {
      customInstanceDetails: 'encrypted:not-json-at-all',
    } as any;

    await provider.post('acct-1', 'token-1', postDetails, integration, {
      client_id: 'x',
      client_secret: 'y',
      instanceUrl: 'https://mastodon.example',
    });

    expect(undiciFetchMock).toHaveBeenCalledWith(
      'https://mastodon.example/api/v1/statuses',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
