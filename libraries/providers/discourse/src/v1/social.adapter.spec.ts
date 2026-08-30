import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DiscourseProvider } from './social.adapter';
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
  baseUrl: 'https://forum.example.com',
  apiKey: 'discourse-api-key',
  apiUsername: 'system',
  defaultCategory: '4',
};

// customInstanceDetails is plaintext in the spec — the mocked
// AuthService.fixedDecryption above passes it through.
const integration = { customInstanceDetails: JSON.stringify(creds) } as any;

describe('DiscourseProvider', () => {
  let provider: DiscourseProvider;

  beforeEach(() => {
    provider = new DiscourseProvider();
    vi.clearAllMocks();
  });

  it('has its own channel identity', () => {
    expect(provider.identifier).toBe('discourse');
    expect(provider.name).toBe('Discourse');
    expect(provider.maxLength()).toBe(32000);
    expect(provider.setupDescriptor?.authType).toBe('direct');
  });

  it('verifies the API key via GET /session/current.json at connect time', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({
        current_user: {
          id: 1,
          username: 'system',
          name: 'System',
          avatar_template: '/user_avatar/forum.example.com/system/{size}/5.png',
        },
      })
    );

    const result = await provider.authenticate({
      code: encodeCallback(creds),
      codeVerifier: 'x',
    });

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://forum.example.com/session/current.json');
    expect(init.headers['Api-Key']).toBe('discourse-api-key');
    expect(init.headers['Api-Username']).toBe('system');
    expect(result).toMatchObject({
      id: '1',
      name: 'System',
      username: 'system',
      picture: 'https://forum.example.com/user_avatar/forum.example.com/system/120/5.png',
    });
  });

  it.each([
    ['http forum URL', { ...creds, baseUrl: 'http://forum.example.com' }],
    ['localhost forum URL', { ...creds, baseUrl: 'https://localhost' }],
    ['IP-literal forum URL', { ...creds, baseUrl: 'https://10.0.0.5' }],
    ['missing API key', { baseUrl: creds.baseUrl, apiKey: '', apiUsername: creds.apiUsername }],
  ])('rejects %s', async (_label, payload) => {
    const result = await provider.authenticate({
      code: encodeCallback(payload as Record<string, string>),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid Discourse credentials');
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it('posts a new topic with a derived title and the default category', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ id: 55, topic_id: 42, topic_slug: 'hello-world-this-is-a-topic', post_number: 1 })
    );

    const responses = await provider.post(
      '1',
      '',
      [
        {
          id: 'post-1',
          message: '# Hello world\n\nThis is **the** very first scheduled topic body.',
          settings: {},
        },
      ],
      integration
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://forum.example.com/posts.json');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.title).toBe('Hello world This is the very first scheduled topic');
    expect(body.raw).toContain('Hello world');
    expect(body.category).toBe(4);

    expect(responses[0]).toEqual({
      id: 'post-1',
      postId: '42',
      releaseURL: 'https://forum.example.com/t/hello-world-this-is-a-topic/42/1',
      status: 'completed',
    });
  });

  it('uploads media and embeds the returned markdown into raw', async () => {
    safeFetchMock.mockResolvedValue({
      blob: async () => new Blob([Buffer.from('img')], { type: 'image/png' }),
    });
    undiciFetchMock
      // upload
      .mockResolvedValueOnce(
        jsonResponse({
          id: 9,
          url: '/uploads/default/original/1X/cat.png',
          short_url: 'upload://abcCat.png',
          original_filename: 'cat.png',
          width: 800,
          height: 600,
        })
      )
      // topic creation
      .mockResolvedValueOnce(
        jsonResponse({ id: 56, topic_id: 43, topic_slug: 'media-topic', post_number: 1 })
      );

    await provider.post(
      '1',
      '',
      [
        {
          id: 'post-2',
          message: 'topic with an attachment',
          settings: {},
          media: [{ type: 'image' as const, path: 'https://cdn.example.com/cat.png', alt: 'a cat' }],
        },
      ],
      integration
    );

    const [uploadUrl, uploadInit] = undiciFetchMock.mock.calls[0];
    expect(uploadUrl).toBe('https://forum.example.com/uploads.json');
    expect(uploadInit.headers['Api-Key']).toBe('discourse-api-key');
    // The kernel fetch port normalizes FormData into a multipart buffer +
    // content-type header before handing it to undici.
    expect(String(uploadInit.headers['content-type'])).toContain('multipart/form-data');
    expect(Buffer.from(uploadInit.body).toString()).toContain('cat.png');

    const body = JSON.parse(undiciFetchMock.mock.calls[1][1].body);
    expect(body.raw).toContain('![a cat|800x600](upload://abcCat.png)');
  });

  it('replies into the topic for comments', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ id: 60, topic_id: 42, topic_slug: 'hello-world-this-is-a-topic', post_number: 2 })
    );

    const responses = await provider.comment(
      '1',
      '42',
      undefined,
      '',
      [{ id: 'comment-1', message: 'first reply', settings: {} }],
      integration
    );

    const [url, init] = undiciFetchMock.mock.calls[0];
    expect(url).toBe('https://forum.example.com/posts.json');
    expect(JSON.parse(init.body)).toEqual({ topic_id: 42, raw: 'first reply' });
    expect(responses[0]).toMatchObject({
      id: 'comment-1',
      postId: '60',
      releaseURL: 'https://forum.example.com/t/hello-world-this-is-a-topic/42/2',
    });
  });

  it('maps a 403 response to a refresh-token (reconnect) error', async () => {
    undiciFetchMock.mockResolvedValue(
      jsonResponse({ errors: ['You are not permitted to view the requested resource.'] }, 403)
    );

    await expect(
      provider.post(
        '1',
        '',
        [{ id: 'post-3', message: 'hi there, this should fail', settings: {} }],
        integration
      )
    ).rejects.toBeInstanceOf(RefreshTokenError);
  });
});
