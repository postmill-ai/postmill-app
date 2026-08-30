import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MatrixProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

vi.mock('@postmill-ai/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: (value: string) => value,
  },
}));

const safeFetchMock = vi.fn();
const undiciFetchMock = vi.fn();

class RefreshTokenError extends Error {}
class BadBodyError extends Error {}

setSocialFetchPorts({
  safeFetch: safeFetchMock,
  undiciFetch: undiciFetchMock,
  ssrfSafeDispatcher: {},
  getVpnDispatcher: () => undefined,
  isSafePublicHttpsUrl: async () => true,
  RefreshTokenError,
  BadBodyError,
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

const encodeCallback = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

const creds = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'syt_matrix_token',
  roomId: '!room:matrix.example.com',
};

// customInstanceDetails is plaintext in the spec — the mocked
// AuthService.fixedDecryption above passes it through.
const integration = { customInstanceDetails: JSON.stringify(creds) } as any;

describe('MatrixProvider', () => {
  let provider: MatrixProvider;

  beforeEach(() => {
    provider = new MatrixProvider();
    vi.clearAllMocks();
  });

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('matrix');
    expect(provider.name).toBe('Matrix');
    expect(provider.maxLength()).toBe(10000);
    expect(provider.setupDescriptor?.authType).toBe('direct');
  });

  it('verifies the access token via GET /account/whoami at connect time', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ user_id: '@alice:matrix.example.com', device_id: 'ABC' })
    );

    const result = await provider.authenticate({
      code: encodeCallback(creds),
      codeVerifier: 'x',
    });

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://matrix.example.com/_matrix/client/v3/account/whoami');
    expect(init.headers.Authorization).toBe('Bearer syt_matrix_token');
    expect(result).toMatchObject({
      id: '@alice:matrix.example.com',
      name: 'alice',
      username: '@alice:matrix.example.com',
      accessToken: 'syt_matrix_token',
    });
  });

  it.each([
    ['http homeserver', { ...creds, homeserverUrl: 'http://matrix.example.com' }],
    ['localhost homeserver', { ...creds, homeserverUrl: 'https://localhost' }],
    ['IP-literal homeserver', { ...creds, homeserverUrl: 'https://192.168.1.1' }],
    ['homeserver with a path', { ...creds, homeserverUrl: 'https://matrix.example.com/homeserver' }],
    ['missing room id', { homeserverUrl: creds.homeserverUrl, accessToken: creds.accessToken, roomId: '' }],
  ])('rejects %s', async (_label, payload) => {
    const result = await provider.authenticate({
      code: encodeCallback(payload),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid Matrix credentials');
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed base64/JSON credentials', async () => {
    const result = await provider.authenticate({ code: 'not-base64!!!', codeVerifier: 'x' });
    expect(result).toBe('Invalid Matrix credentials');
  });

  it('posts a text-only m.text message event', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({ event_id: '$evt1:matrix.example.com' }));

    const responses = await provider.post(
      '@alice:matrix.example.com',
      '',
      [{ id: 'post-1', message: 'hello matrix', settings: {} }],
      integration
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toContain(
      'https://matrix.example.com/_matrix/client/v3/rooms/!room%3Amatrix.example.com/send/m.room.message/'
    );
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ msgtype: 'm.text', body: 'hello matrix' });

    expect(responses[0]).toMatchObject({
      id: 'post-1',
      postId: '$evt1:matrix.example.com',
      status: 'completed',
    });
    expect(responses[0].releaseURL).toContain('https://matrix.to/#/');
  });

  it('uploads media first, then sends an m.image event with the content_uri', async () => {
    safeFetchMock.mockResolvedValue({
      blob: async () => new Blob([Buffer.from('png-bytes')], { type: 'image/png' }),
    });
    undiciFetchMock
      // text event
      .mockResolvedValueOnce(jsonResponse({ event_id: '$evt-text' }))
      // media upload
      .mockResolvedValueOnce(jsonResponse({ content_uri: 'mxc://matrix.example.com/abc123' }))
      // image event
      .mockResolvedValueOnce(jsonResponse({ event_id: '$evt-img' }));

    const responses = await provider.post(
      '@alice:matrix.example.com',
      '',
      [
        {
          id: 'post-2',
          message: 'with image',
          settings: {},
          media: [{ type: 'image' as const, path: 'https://cdn.example.com/cat.png', alt: 'a cat' }],
        },
      ],
      integration
    );

    expect(undiciFetchMock).toHaveBeenCalledTimes(3);

    const [uploadUrl, uploadInit] = undiciFetchMock.mock.calls[1];
    expect(uploadUrl).toBe(
      'https://matrix.example.com/_matrix/media/v3/upload?filename=cat.png'
    );
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers['Content-Type']).toBe('image/png');
    expect(uploadInit.headers.Authorization).toBe('Bearer syt_matrix_token');

    const [, imageInit] = undiciFetchMock.mock.calls[2];
    expect(JSON.parse(imageInit.body)).toEqual({
      msgtype: 'm.image',
      body: 'a cat',
      url: 'mxc://matrix.example.com/abc123',
      info: { mimetype: 'image/png', size: 9 },
    });

    expect(responses[0].postId).toBe('$evt-text');
  });

  it('maps a 401 response to a refresh-token (reconnect) error', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid access token' }, 401)
    );

    await expect(
      provider.post(
        '@alice:matrix.example.com',
        '',
        [{ id: 'post-3', message: 'hi', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(RefreshTokenError);
  });
});
