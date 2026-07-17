import { describe, it, expect, vi, beforeEach } from 'vitest';

// Partially mock the kernel so `safeFetch` is a spy while SocialAbstract / the
// BadBody Proxy / setSocialFetchPorts (all needed to construct + throw) stay real.
vi.mock('@gitroom/provider-kernel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, safeFetch: vi.fn() };
});

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2Mock() {
        return {
          setCredentials: vi.fn(),
          refreshAccessToken: vi.fn().mockResolvedValue({
            credentials: {
              access_token: 'access-token',
              expiry_date: Date.now() + 3600000,
            },
          }),
          getToken: vi.fn().mockResolvedValue({
            tokens: {
              access_token: 'access-token',
              expiry_date: Date.now() + 3600000,
            },
          }),
          getTokenInfo: vi.fn().mockResolvedValue({ scopes: [] }),
          generateAuthUrl: vi.fn().mockReturnValue('https://auth.example'),
        };
      }),
    },
    youtube: vi.fn(),
    oauth2: vi.fn().mockImplementation(() => ({
      userinfo: {
        get: vi.fn().mockResolvedValue({
          data: { id: 'u1', name: 'User', picture: '' },
        }),
      },
    })),
    youtubeAnalytics: vi.fn().mockImplementation(() => ({
      reports: { query: vi.fn() },
    })),
  },
  youtube_v3: {},
}));

import { safeFetch, setSocialFetchPorts } from '@gitroom/provider-kernel';
import { google } from 'googleapis';
import { YoutubeProvider } from './social.adapter';

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

describe('YoutubeProvider.post (FETCH-04)', () => {
  const mockInsert = vi.fn();
  const mockSet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReset();
    mockSet.mockReset();

    (google.youtube as any).mockReturnValue({
      videos: { insert: mockInsert, list: vi.fn() },
      thumbnails: { set: mockSet },
      commentThreads: { list: vi.fn() },
      comments: { insert: vi.fn() },
    });

    setSocialFetchPorts({
      getVpnDispatcher: () => undefined,
      ssrfSafeDispatcher: undefined,
      isSafePublicHttpsUrl: async () => true,
      undiciFetch: (async () => new Response()) as any,
      RefreshTokenError: class extends Error {},
      BadBodyError: TestBadBody,
      timer: (async () => undefined) as any,
      sharp: (() => ({
        metadata: async () => ({ width: 100, height: 100 }),
      })) as any,
      readOrFetch: (async () => Buffer.from('x')) as any,
      safeFetch: (async () => new Response('media-bytes')) as any,
    } as any);
  });

  const makePostDetails = (mediaUrl: string, thumbnailUrl?: string) =>
    [
      {
        id: 'p1',
        message: 'Hello YouTube',
        media: [{ path: mediaUrl }],
        settings: {
          title: 'Video title',
          type: 'public',
          selfDeclaredMadeForKids: 'no',
          ...(thumbnailUrl ? { thumbnail: { path: thumbnailUrl } } : {}),
        },
      },
    ] as any;

  it('downloads media and thumbnail through safeFetch', async () => {
    // Return a fresh Response per URL so each body stream is only consumed once.
    (safeFetch as any).mockImplementation(async (url: string) =>
      new Response(`${url}-bytes`, { status: 200 })
    );
    mockInsert.mockResolvedValue({ data: { id: 'video-1' } });
    mockSet.mockResolvedValue({});

    const provider = new YoutubeProvider();
    const result = await provider.post(
      'id',
      'access-token',
      makePostDetails(
        'https://cdn.example.com/video.mp4',
        'https://cdn.example.com/thumb.jpg'
      )
    );

    expect(safeFetch).toHaveBeenCalledWith('https://cdn.example.com/video.mp4');
    expect(safeFetch).toHaveBeenCalledWith('https://cdn.example.com/thumb.jpg');
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledTimes(1);

    const insertMediaBody = mockInsert.mock.calls[0][0].media.body;
    expect(insertMediaBody).toBeDefined();
    expect(typeof insertMediaBody.on).toBe('function'); // Node Readable

    const setMediaBody = mockSet.mock.calls[0][0].media.body;
    expect(setMediaBody).toBeDefined();
    expect(typeof setMediaBody.on).toBe('function');

    expect(result).toEqual([
      {
        id: 'p1',
        releaseURL: 'https://www.youtube.com/watch?v=video-1',
        postId: 'video-1',
        status: 'success',
      },
    ]);
  });

  it('rejects non-2xx media responses instead of uploading them', async () => {
    (safeFetch as any).mockImplementation(async (url: string) => {
      if (url === 'https://cdn.example.com/video.mp4') {
        return new Response('not found', {
          status: 404,
          statusText: 'Not Found',
        });
      }
      return new Response('thumb-bytes', { status: 200 });
    });

    const provider = new YoutubeProvider();

    await expect(
      provider.post(
        'id',
        'access-token',
        makePostDetails(
          'https://cdn.example.com/video.mp4',
          'https://cdn.example.com/thumb.jpg'
        )
      )
    ).rejects.toThrow('Failed to fetch media: 404 Not Found');

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects private-IP media URLs propagated by safeFetch', async () => {
    (safeFetch as any).mockRejectedValue(new Error('Blocked URL'));

    const provider = new YoutubeProvider();

    await expect(
      provider.post(
        'id',
        'access-token',
        makePostDetails('http://192.168.1.1/video.mp4')
      )
    ).rejects.toThrow('Blocked URL');

    expect(safeFetch).toHaveBeenCalledWith('http://192.168.1.1/video.mp4');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('uploads a video without a thumbnail when none is supplied', async () => {
    (safeFetch as any).mockResolvedValue(
      new Response('media-bytes', { status: 200 })
    );
    mockInsert.mockResolvedValue({ data: { id: 'video-2' } });

    const provider = new YoutubeProvider();
    const result = await provider.post(
      'id',
      'access-token',
      makePostDetails('https://cdn.example.com/video.mp4')
    );

    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockSet).not.toHaveBeenCalled();
    expect(result[0].postId).toBe('video-2');
  });
});
