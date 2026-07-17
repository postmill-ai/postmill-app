import { describe, it, expect, vi, beforeEach } from 'vitest';

// Partially mock the kernel so `safeFetch` is a spy while SocialAbstract / the
// BadBody Proxy / setSocialFetchPorts (all needed to construct + throw) stay real.
vi.mock('@gitroom/provider-kernel', async (orig) => {
  const actual: any = await orig();
  return { ...actual, safeFetch: vi.fn() };
});

// The adapter imports the polling delay directly from helpers; make it immediate
// in tests so bounded loops do not wait for real 30s sleeps.
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: async () => undefined,
}));

import { safeFetch, setSocialFetchPorts } from '@gitroom/provider-kernel';
import { PinterestProvider } from './social.adapter';

// The `BadBody` kernel Proxy constructs `new _ports.BadBodyError(...args)`, where
// args = (provider, body, raw, reason). Capture `reason` as the Error message so
// the test can assert the guard fired with the right status.
class TestBadBody extends Error {
  constructor(
    public provider: string,
    public body: string,
    public raw: unknown,
    public reason: string,
  ) {
    super(reason);
  }
}

const UPLOAD_URL = 'https://s3.example.com/presigned';
const postDetails = [
  {
    id: 'p1',
    message: 'hi',
    settings: {},
    media: [{ path: 'https://cdn.example.com/video.mp4' }],
  },
] as any;

describe('PinterestProvider.post — presigned upload failure (0.1)', () => {
  let provider: PinterestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    setSocialFetchPorts({
      getVpnDispatcher: () => undefined,
      ssrfSafeDispatcher: undefined,
      isSafePublicHttpsUrl: async () => true,
      undiciFetch: (async () => new Response()) as any,
      RefreshTokenError: class extends Error {},
      BadBodyError: TestBadBody,
      timer: (async () => undefined) as any,
      sharp: (() => ({ metadata: async () => ({ width: 100, height: 100 }) })) as any,
      readOrFetch: (async () => Buffer.from('x')) as any,
      safeFetch: (async () => new Response()) as any,
    } as any);

    provider = new PinterestProvider();
    // this.fetch → the media-creation call returns the presigned target.
    vi.spyOn(provider as any, 'fetch').mockResolvedValue({
      json: async () => ({
        upload_url: UPLOAD_URL,
        media_id: 'media-1',
        upload_parameters: { key: 'k' },
      }),
    });
  });

  it('throws BadBody on a non-2xx presigned upload instead of entering the poll loop', async () => {
    (safeFetch as any).mockImplementation(async (url: string) => {
      if (url === UPLOAD_URL) {
        // S3 rejects the (expired/oversized) presigned policy. safeFetch returns
        // non-2xx WITHOUT throwing — the guard must catch it and fail fast.
        return { ok: false, status: 403 };
      }
      // the source-media download leg (no stream body → readBoundedBlob falls back)
      return {
        ok: true,
        status: 200,
        body: null,
        headers: { get: () => 'video/mp4' },
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      };
    });

    const err = await provider.post('id', 'token', postDetails).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toBe('Media upload failed (status 403)');

    // The media-creation call fired once; the poll loop (a SECOND this.fetch to
    // /v5/media/<id>) was never reached because we failed fast.
    expect((provider as any).fetch).toHaveBeenCalledTimes(1);
  });

  // 2.4: the streaming cap must abort mid-stream — a chunked body crossing the
  // limit is cancelled, not buffered to completion and measured afterwards.
  it('readBoundedBlob aborts a chunked body that crosses the byte cap', async () => {
    const chunks = [new Uint8Array(8), new Uint8Array(8)];
    let reads = 0;
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = {
      body: {
        getReader: () => ({
          read: async () =>
            reads < chunks.length
              ? { done: false, value: chunks[reads++] }
              : { done: true, value: undefined },
          cancel,
          releaseLock: vi.fn(),
        }),
      },
      headers: { get: () => 'video/mp4' },
    } as unknown as Response;

    const err = await (provider as any)
      .readBoundedBlob(response, 10)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toMatch(/exceeds the .*upload cap/);
    // Aborted at the crossing chunk — the stream was cancelled, not drained.
    expect(cancel).toHaveBeenCalled();
    expect(reads).toBe(2);
  });

  it('readBoundedBlob passes a body under the cap through intact', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    let read = false;
    const response = {
      body: {
        getReader: () => ({
          read: async () =>
            read
              ? { done: true, value: undefined }
              : ((read = true), { done: false, value: payload }),
          cancel: vi.fn(),
          releaseLock: vi.fn(),
        }),
      },
      headers: { get: () => 'video/mp4' },
    } as unknown as Response;

    const blob: Blob = await (provider as any).readBoundedBlob(response, 10);
    expect(blob.size).toBe(4);
    expect(blob.type).toBe('video/mp4');
  });
});

describe('PinterestProvider.post — video status polling (POLL-05)', () => {
  let provider: PinterestProvider;
  const makeFetch =
    (statusSequence: string[], pinId = 'pin-1') =>
    async (url: string) => {
      if (url === 'https://api.pinterest.com/v5/media') {
        return {
          json: async () => ({
            upload_url: UPLOAD_URL,
            media_id: 'media-1',
            upload_parameters: { key: 'k' },
          }),
        };
      }
      if (url.startsWith('https://api.pinterest.com/v5/media/')) {
        const status = statusSequence.shift() ?? 'processing';
        return { json: async () => ({ status }) };
      }
      if (url === 'https://api.pinterest.com/v5/pins') {
        return { json: async () => ({ id: pinId }) };
      }
      return { json: async () => ({}) };
    };

  beforeEach(() => {
    vi.clearAllMocks();
    setSocialFetchPorts({
      getVpnDispatcher: () => undefined,
      ssrfSafeDispatcher: undefined,
      isSafePublicHttpsUrl: async () => true,
      undiciFetch: (async () => new Response()) as any,
      RefreshTokenError: class extends Error {},
      BadBodyError: TestBadBody,
      timer: (async () => undefined) as any,
      sharp: (() => ({ metadata: async () => ({ width: 100, height: 100 }) })) as any,
      readOrFetch: (async () => Buffer.from('x')) as any,
      safeFetch: (async () =>
        ({
          ok: true,
          status: 200,
          body: null,
          headers: { get: () => 'video/mp4' },
          blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
        }) as any),
    } as any);

    provider = new PinterestProvider();
    // The module-level vi.mock turns the imported safeFetch into a mock fn.
    // Reset it here so each polling test starts with a working download+upload leg.
    (safeFetch as any).mockImplementation(async (url: string) => {
      if (url === UPLOAD_URL) {
        return { ok: true, status: 200 };
      }
      return {
        ok: true,
        status: 200,
        body: null,
        headers: { get: () => 'video/mp4' },
        blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      };
    });
  });

  it('succeeds when the video reaches succeeded after a few processing polls', async () => {
    vi.spyOn(provider as any, 'fetch').mockImplementation(
      makeFetch(['processing', 'processing', 'succeeded']) as any,
    );

    const result = await provider.post('id', 'token', postDetails);

    expect(result).toEqual([
      {
        id: 'p1',
        postId: 'pin-1',
        releaseURL: 'https://www.pinterest.com/pin/pin-1',
        status: 'success',
      },
    ]);
  });

  it('throws a terminal BadBody when Pinterest reports failed', async () => {
    vi.spyOn(provider as any, 'fetch').mockImplementation(makeFetch(['failed']) as any);

    const err = await provider.post('id', 'token', postDetails).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toBe(
      'The file is corrupted and cannot be uploaded',
    );
  });

  it('stops after maxAttempts and rejects with a timeout error', async () => {
    // 21 non-terminal responses — one more than the 20-attempt cap.
    vi.spyOn(provider as any, 'fetch').mockImplementation(
      makeFetch(new Array(21).fill('processing')) as any,
    );

    const err = await provider.post('id', 'token', postDetails).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toMatch(
      /Pinterest video processing timed out \(status: processing, attempts: 20\)/,
    );
  });

  it('stops immediately on an unexpected status and rejects', async () => {
    vi.spyOn(provider as any, 'fetch').mockImplementation(
      makeFetch(['weird_status']) as any,
    );

    const err = await provider.post('id', 'token', postDetails).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(TestBadBody);
    expect((err as TestBadBody).reason).toBe(
      'Unexpected Pinterest media status: weird_status',
    );
  });
});
