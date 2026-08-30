import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LineProvider } from './social.adapter';
import { setSocialFetchPorts } from '@postmill-ai/provider-kernel';

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

const clientInformation = {
  client_id: 'line-channel-access-token',
  client_secret: '',
  instanceUrl: '',
};

describe('LineProvider', () => {
  let provider: LineProvider;

  beforeEach(() => {
    provider = new LineProvider();
    vi.clearAllMocks();
  });

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('line');
    expect(provider.name).toBe('LINE');
    expect(provider.maxLength()).toBe(5000);
    expect(provider.setupDescriptor?.authType).toBe('token');
  });

  it('verifies the token via GET /v2/bot/info at connect time', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({
        userId: 'U1234567890abcdef',
        basicId: '@lineoa',
        displayName: 'My Shop',
        pictureUrl: 'https://profile.line-scdn.net/abc',
      })
    );

    const result = await provider.authenticate(
      { code: '', codeVerifier: '' },
      clientInformation
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/info');
    expect(init.headers.Authorization).toBe('Bearer line-channel-access-token');

    expect(result).toMatchObject({
      id: 'U1234567890abcdef',
      name: 'My Shop',
      username: '@lineoa',
      accessToken: 'line-channel-access-token',
    });
  });

  it('returns an error string when the token is missing', async () => {
    const result = await provider.authenticate(
      { code: '', codeVerifier: '' },
      { client_id: '', client_secret: '', instanceUrl: '' }
    );
    expect(result).toBe('Channel access token is required');
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('posts a text-only broadcast', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({}));

    const responses = await provider.post(
      'U123',
      'line-channel-access-token',
      [
        {
          id: 'post-1',
          message: 'Hello LINE friends',
          settings: {},
        },
      ],
      {} as any,
      clientInformation
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/broadcast');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer line-channel-access-token');
    expect(init.headers['X-Line-Retry-Key']).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({
      messages: [{ type: 'text', text: 'Hello LINE friends' }],
    });

    expect(responses).toHaveLength(1);
    expect(responses[0].id).toBe('post-1');
    expect(responses[0].postId).toBeTruthy();
    expect(responses[0].status).toBe('completed');
  });

  it('posts media by public URL (image and video)', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({}));

    await provider.post(
      'U123',
      'line-channel-access-token',
      [
        {
          id: 'post-2',
          message: 'Look at this',
          settings: {},
          media: [
            { type: 'image' as const, path: 'https://cdn.example.com/a.png' },
            {
              type: 'video' as const,
              path: 'https://cdn.example.com/b.mp4',
              thumbnail: 'https://cdn.example.com/b.jpg',
            },
          ],
        },
      ],
      {} as any,
      clientInformation
    );

    const body = JSON.parse(undiciFetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { type: 'text', text: 'Look at this' },
      {
        type: 'image',
        originalContentUrl: 'https://cdn.example.com/a.png',
        previewImageUrl: 'https://cdn.example.com/a.png',
      },
      {
        type: 'video',
        originalContentUrl: 'https://cdn.example.com/b.mp4',
        previewImageUrl: 'https://cdn.example.com/b.jpg',
      },
    ]);
  });

  it('chunks broadcasts to respect the 5-messages-per-call cap', async () => {
    undiciFetchMock.mockResolvedValue(jsonResponse({}));

    const media = Array.from({ length: 6 }, (_, i) => ({
      type: 'image' as const,
      path: `https://cdn.example.com/${i}.png`,
    }));

    await provider.post(
      'U123',
      'line-channel-access-token',
      [{ id: 'post-3', message: 'many', settings: {}, media }],
      {} as any,
      clientInformation
    );

    // text + 6 images = 7 message objects → 2 broadcast calls (5 + 2)
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(undiciFetchMock.mock.calls[0][1].body);
    const second = JSON.parse(undiciFetchMock.mock.calls[1][1].body);
    expect(first.messages).toHaveLength(5);
    expect(second.messages).toHaveLength(2);
  });

  it('maps a 401 response to a refresh-token (reconnect) error', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ message: 'Invalid channel access token' }, 401)
    );

    await expect(
      provider.post(
        'U123',
        'bad-token',
        [{ id: 'post-4', message: 'hi', settings: {} }],
        {} as any,
        { client_id: '', client_secret: '', instanceUrl: '' }
      )
    ).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it('rejects non-https media in checkValidity', async () => {
    await expect(
      provider.checkValidity([[{ path: 'http://insecure.example.com/a.png' }]])
    ).resolves.toBe('LINE can only publish media hosted on a public https URL');
    await expect(
      provider.checkValidity([[{ path: 'https://cdn.example.com/a.png' }]])
    ).resolves.toBe(true);
  });

  it('reads channel followers from the insight endpoint', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ status: 'ready', followers: 7620, targetedReaches: 5000, blocks: 12 })
    );

    const data = await provider.analytics('U123', 'line-channel-access-token', 7, clientInformation);

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toContain('https://api.line.me/v2/bot/insight/followers?date=');
    expect(init.headers.Authorization).toBe('Bearer line-channel-access-token');
    expect(data).toEqual([
      {
        label: 'Followers',
        data: [{ total: '7620', date: expect.any(String) }],
      },
    ]);
  });

  it('returns no analytics while the insight calculation is unready', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ status: 'unready', followers: null, targetedReaches: null, blocks: null })
    );
    await expect(
      provider.analytics('U123', 'token', 7, clientInformation)
    ).resolves.toEqual([]);
  });
});
