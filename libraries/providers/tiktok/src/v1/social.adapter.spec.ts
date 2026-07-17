import { describe, it, expect, vi, beforeEach } from 'vitest';

// Speed up the publish-status poll loop so bounded-loop tests finish instantly.
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn(async () => undefined),
}));

// Keep the real kernel exports but turn `safeFetch` into a spy for any
// future download assertions.
vi.mock('@gitroom/provider-kernel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, safeFetch: vi.fn() };
});

import { setSocialFetchPorts } from '@gitroom/provider-kernel';
import { TiktokProvider } from './social.adapter';

// The kernel's `BadBody` is a Proxy that delegates construction to the
// port-injected `BadBodyError`. Capture its args as instance fields so tests
// can assert the terminal timeout reason.
class TestBadBody extends Error {
  constructor(
    public provider: string,
    public body: string,
    public raw: unknown,
    public reason: string
  ) {
    super(reason);
  }
}

const mockPorts = (): void =>
  setSocialFetchPorts({
    getVpnDispatcher: (): any => undefined,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: async (): Promise<boolean> => true,
    undiciFetch: (async (): Promise<any> => new Response()) as any,
    RefreshTokenError: class extends Error {},
    BadBodyError: TestBadBody,
    timer: (async (): Promise<void> => undefined) as any,
    sharp: ((): any => ({
      metadata: async (): Promise<{ width: number; height: number }> => ({
        width: 100,
        height: 100,
      }),
    })) as any,
    readOrFetch: (async (): Promise<Buffer> => Buffer.from('x')) as any,
    safeFetch: (async (): Promise<any> => new Response()) as any,
  } as any);

describe('TiktokProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('FRONTEND_URL', 'https://app.example.com');
    mockPorts();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POLL-01: publish-status polling is bounded', () => {
    it('stops after 30 PROCESSING responses and throws a terminal BadBody', async () => {
      const provider = new TiktokProvider();
      const fetchSpy = vi
        .spyOn(provider as any, 'fetch')
        .mockResolvedValue({
          json: async () =>
            ({
              data: {
                status: 'PROCESSING',
                publicaly_available_post_id: null,
              },
            } as any),
        } as any);

      const err = await (provider as any)
        .uploadedVideoSuccess('user-id', 'publish-1', 'token')
        .then(
          (): null => null,
          (e: unknown): unknown => e
        );

      expect(err).toBeInstanceOf(TestBadBody);
      expect((err as TestBadBody).provider).toBe('tiktok-publish-timeout');
      expect((err as TestBadBody).reason).toMatch(
        /did not become terminal after 30 attempts/
      );
      expect(fetchSpy).toHaveBeenCalledTimes(30);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ publish_id: 'publish-1' }),
        }),
        '',
        0,
        true
      );
    });

    it('returns the post URL as soon as status becomes PUBLISH_COMPLETE', async () => {
      const provider = new TiktokProvider();
      vi.spyOn(provider as any, 'fetch')
        .mockResolvedValueOnce({
          json: async () => ({ data: { status: 'PROCESSING' } }),
        } as any)
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              status: 'PUBLISH_COMPLETE',
              publicaly_available_post_id: ['12345'],
            },
          }),
        } as any);

      const result = await (provider as any).uploadedVideoSuccess(
        'user-id',
        'publish-2',
        'token'
      );

      expect(result).toEqual({
        url: 'https://www.tiktok.com/@user-id/video/12345',
        id: '12345',
      });
    });
  });

  describe('FETCH-01: OAuth/token and user-info calls use this.fetch()', () => {
    it('refreshToken routes token + user-info fetches through this.fetch', async () => {
      const provider = new TiktokProvider();
      const fetchSpy = vi
        .spyOn(provider as any, 'fetch')
        .mockResolvedValueOnce({
          json: async () => ({
            access_token: 'at-1',
            refresh_token: 'rt-1',
          }),
        } as any)
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              user: {
                open_id: 'abcd-1234',
                avatar_url: 'https://cdn.example.com/avatar.png',
                display_name: 'Test User',
                username: 'testuser',
              },
            },
          }),
        } as any);

      const result = await provider.refreshToken('rt', {
        client_id: 'client1',
        client_secret: 'secret1',
        instanceUrl: '',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        'https://open.tiktokapis.com/v2/oauth/token/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('refresh_token=rt'),
        })
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer at-1' },
        })
      );
      expect(result.accessToken).toBe('at-1');
      expect(result.refreshToken).toBe('rt-1');
      expect(result.id).toBe('abcd1234');
    });

    it('authenticate routes token + user-info fetches through this.fetch', async () => {
      const provider = new TiktokProvider();
      const fetchSpy = vi
        .spyOn(provider as any, 'fetch')
        .mockResolvedValueOnce({
          json: async () => ({
            access_token: 'at-2',
            refresh_token: 'rt-2',
            scope: 'video.list,user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats',
          }),
        } as any)
        .mockResolvedValueOnce({
          json: async () => ({
            data: {
              user: {
                open_id: 'efgh-5678',
                avatar_url: 'https://cdn.example.com/avatar2.png',
                display_name: 'Test User 2',
                username: 'testuser2',
              },
            },
          }),
        } as any);

      const result = await provider.authenticate(
        { code: 'code-1', codeVerifier: 'cv-1' },
        { client_id: 'client1', client_secret: 'secret1', instanceUrl: '' }
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        'https://open.tiktokapis.com/v2/oauth/token/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('code=code-1'),
        })
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer at-2' },
        })
      );
      expect(result.accessToken).toBe('at-2');
      expect(result.refreshToken).toBe('rt-2');
      expect(result.id).toBe('efgh5678');
    });

    it('maxVideoLength routes the creator-info call through this.fetch', async () => {
      const provider = new TiktokProvider();
      const fetchSpy = vi
        .spyOn(provider as any, 'fetch')
        .mockResolvedValueOnce({
          json: async () => ({
            data: { max_video_post_duration_sec: 600 },
          }),
        } as any);

      const result = await provider.maxVideoLength('token-1');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: 'Bearer token-1',
          },
        })
      );
      expect(result.maxDurationSeconds).toBe(600);
    });
  });
});
