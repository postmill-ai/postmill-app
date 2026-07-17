import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bluesky provider remediation tests:
// - FETCH-05: image downloads route through safeFetch (SSRF/public-URL validation).
// - POLL-07: video blob polling is capped and fails terminally when the cap is hit.

const h = vi.hoisted(() => ({
  getJobStatusMock: vi.fn(),
  postArgs: [] as any[],
  loginArgs: [] as any[],
  agentOpts: [] as any[],
}));

vi.mock('@gitroom/provider-kernel', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    safeFetch: vi.fn(async () => new Response('ok', { status: 200 })),
  };
});

vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedDecryption: () =>
      JSON.stringify({
        service: 'https://bsky.social',
        identifier: 'me.bsky.social',
        password: 'app-password',
      }),
  },
}));

vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    resize: vi.fn(function (this: any) {
      return this;
    }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image')),
  })),
}));

vi.mock('@atproto/api', () => ({
  BskyAgent: class {
    dispatchUrl = new URL('https://bsky.social');
    session = { did: 'did:plc:abc', handle: 'me.bsky.social' };
    constructor(public opts: any) {
      h.agentOpts.push(opts);
    }
    async login(args: any) {
      h.loginArgs.push(args);
      return {
        data: {
          accessJwt: 'access-jwt',
          refreshJwt: 'refresh-jwt',
          handle: 'me.bsky.social',
          did: 'did:plc:abc',
        },
      };
    }
    async getProfile() {
      return {
        data: { displayName: 'User', handle: 'me.bsky.social', avatar: '' },
      };
    }
    async post(record: any) {
      h.postArgs.push(record);
      return { cid: 'cid-1', uri: 'at://did:plc:abc/app.bsky.feed.post/xyz' };
    }
    async uploadBlob() {
      return { data: { blob: { $link: 'blob-ref' } } };
    }
    com = {
      atproto: {
        server: {
          getServiceAuth: async () => ({
            data: { token: 'service-token' },
          }),
        },
      },
    };
  },
  AtpAgent: class {
    service: string;
    constructor(opts: any) {
      this.service = opts.service;
    }
    app = {
      bsky: {
        video: {
          getJobStatus: h.getJobStatusMock,
        },
      },
    };
  },
  RichText: class {
    text: string;
    facets: any[] = [];
    constructor(o: any) {
      this.text = o.text;
    }
    async detectFacets() {}
  },
  AppBskyEmbedVideo: {},
  AppBskyVideoDefs: {},
  BlobRef: class {},
}));

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

import { safeFetch, setSocialFetchPorts } from '@gitroom/provider-kernel';
import { BlueskyProvider } from './social.adapter';

beforeEach(() => {
  vi.clearAllMocks();
  h.postArgs.length = 0;
  h.loginArgs.length = 0;
  h.agentOpts.length = 0;
  h.getJobStatusMock.mockReset();

  setSocialFetchPorts({
    getVpnDispatcher: (): any => undefined,
    ssrfSafeDispatcher: undefined,
    isSafePublicHttpsUrl: async (): Promise<boolean> => true,
    undiciFetch: (async (): Promise<any> => new Response()) as any,
    RefreshTokenError: class extends Error {},
    BadBodyError: TestBadBody,
    timer: (async (): Promise<any> => undefined) as any,
    sharp: (() => ({
      metadata: async () => ({ width: 100, height: 100 }),
      resize: function (this: any) {
        return this;
      },
      toBuffer: async () => Buffer.from('resized-image'),
    })) as any,
    readOrFetch: (async () => Buffer.from('x')) as any,
    safeFetch: safeFetch as any,
  } as any);
});

const encodeCallback = (payload: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

describe('BlueskyProvider.authenticate (S-19)', () => {
  it('accepts a valid callback payload', async () => {
    const provider = new BlueskyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'https://bsky.social',
        identifier: 'me.bsky.social',
        password: 'app-password',
      }),
      codeVerifier: 'x',
    });
    if (typeof result === 'string') {
      throw new Error(`Expected object, got: ${result}`);
    }
    expect(result.username).toBe('me.bsky.social');
  });

  it('rejects non-https service', async () => {
    const provider = new BlueskyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'http://bsky.social',
        identifier: 'me.bsky.social',
        password: 'app-password',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects localhost service', async () => {
    const provider = new BlueskyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({
        service: 'https://localhost',
        identifier: 'me.bsky.social',
        password: 'app-password',
      }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects malformed base64/JSON', async () => {
    const provider = new BlueskyProvider();
    const result = await provider.authenticate({
      code: 'not-base64!!!',
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });

  it('rejects missing required fields', async () => {
    const provider = new BlueskyProvider();
    const result = await provider.authenticate({
      code: encodeCallback({ service: 'https://bsky.social' }),
      codeVerifier: 'x',
    });
    expect(result).toBe('Invalid credentials');
  });
});

describe('BlueskyProvider remediation', () => {
  it('FETCH-05: routes image downloads through safeFetch', async () => {
    const imageUrl = 'https://cdn.example.com/image.png';
    (safeFetch as any).mockImplementation(async (url: string) => {
      if (url === imageUrl) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      }
      return { ok: false, status: 404 };
    });

    const provider = new BlueskyProvider();
    await provider.post(
      'me.bsky.social',
      'unused-access-token',
      [
        {
          id: 'p1',
          message: 'hello bluesky world',
          media: [{ path: imageUrl }],
          settings: {},
        } as any,
      ],
      { customInstanceDetails: 'encrypted' } as any
    );

    expect((safeFetch as any).mock.calls.some((c: any[]) => c[0] === imageUrl)).toBe(true);
    expect(h.agentOpts[0]).toEqual({ service: 'https://bsky.social' });
    expect(h.postArgs[0].text).toBe('hello bluesky world');
  });

  it('POLL-07: caps video blob polling and fails terminally after max attempts', async () => {
    const videoUrl = 'https://cdn.example.com/video.mp4';
    (safeFetch as any).mockImplementation(async (url: string) => {
      if (url.includes('app.bsky.video.uploadVideo')) {
        return new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 });
      }
      return new Response('media-bytes', { status: 200 });
    });

    h.getJobStatusMock.mockResolvedValue({
      data: {
        jobStatus: { state: 'JOB_STATE_CREATED' },
      },
    });

    const provider = new BlueskyProvider();
    const err = await provider
      .post(
        'me.bsky.social',
        'unused-access-token',
        [
          {
            id: 'p1',
            message: 'video post',
            media: [{ path: videoUrl }],
            settings: {},
          } as any,
        ],
        { customInstanceDetails: 'encrypted' } as any
      )
      .then(
        () => null,
        (e) => e
      );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toBe(
      'Could not upload video, blob processing timed out'
    );
    expect(h.getJobStatusMock).toHaveBeenCalledTimes(20);
    expect(h.getJobStatusMock).toHaveBeenLastCalledWith({ jobId: 'job-1' });
  });
});
