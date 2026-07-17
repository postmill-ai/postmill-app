import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Postmill from './index';

describe('Postmill SDK', () => {
  it('exports a configurable Postmill client', () => {
    const client = new Postmill('test-api-key');
    expect(client).toBeInstanceOf(Postmill);
    expect(typeof client.post).toBe('function');
    expect(typeof client.postList).toBe('function');
    expect(typeof client.upload).toBe('function');
    expect(typeof client.integrations).toBe('function');
    expect(typeof client.deletePost).toBe('function');
    expect(typeof client.uploadFromUrl).toBe('function');
    expect(typeof client.generateVideoAndWait).toBe('function');
  });

  it('allows overriding the API base path', () => {
    const client = new Postmill('test-api-key', 'https://custom.example.com');
    expect(client).toBeInstanceOf(Postmill);
  });
});

describe('Postmill SDK HTTP calls', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(body: unknown) {
    fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce(body),
    } as unknown as Response);
  }

  it('posts with the correct URL, method, headers and body', async () => {
    mockJsonResponse({ success: true });

    const client = new Postmill('pm_live_123');
    await client.post({
      type: 'schedule',
      date: '2026-01-01T12:00:00.000Z',
      shortLink: false,
      tags: [],
      posts: [],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmill.ai/public/v1/posts');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'pm_live_123',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toMatchObject({ type: 'schedule' });
  });

  it('lists posts with query string', async () => {
    mockJsonResponse({ posts: [] });

    const client = new Postmill('pm_live_123');
    await client.postList({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-31T23:59:59.000Z',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/public\/v1\/posts\?/);
    expect(url).toContain('startDate=');
    expect(url).toContain('endDate=');
  });

  it('uploads from a URL', async () => {
    mockJsonResponse({ path: 'https://cdn.example.com/file.png' });

    const client = new Postmill('pm_live_123');
    await client.uploadFromUrl('https://example.com/image.png');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmill.ai/public/v1/upload-from-url');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      url: 'https://example.com/image.png',
    });
  });

  it('extends integrations with an optional group filter', async () => {
    mockJsonResponse([]);

    const client = new Postmill('pm_live_123');
    await client.integrations('group-1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmill.ai/public/v1/integrations?group=group-1');
  });

  it('connects a channel with refresh and version query params', async () => {
    mockJsonResponse({ url: 'https://provider.example.com/oauth' });

    const client = new Postmill('pm_live_123');
    await client.connectChannel('provider-x', { refresh: 'old-id', version: 'v2' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.postmill.ai/public/v1/social/provider-x?refresh=old-id&version=v2'
    );
  });

  it('starts a video generation job', async () => {
    mockJsonResponse({
      id: 'job-1',
      status: 'pending',
      jobId: 'job-1',
      path: '',
      name: '',
      pollUrl: '/public/v1/generate-video/job-1',
    });

    const client = new Postmill('pm_live_123');
    const result = await client.generateVideo({
      type: 'text-to-video',
      output: 'vertical',
    });

    expect(result.status).toBe('pending');
    expect(result.pollUrl).toBe('/public/v1/generate-video/job-1');
  });

  it('polls generateVideoAndWait until completed', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce({
          id: 'job-1',
          status: 'pending',
          jobId: 'job-1',
          path: '',
          name: '',
          pollUrl: '/public/v1/generate-video/job-1',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce({
          id: 'job-1',
          status: 'completed',
          jobId: '',
          path: 'https://cdn.example.com/video.mp4',
          name: '',
          pollUrl: '',
        }),
      } as unknown as Response);

    const client = new Postmill('pm_live_123');
    const result = await client.generateVideoAndWait(
      { type: 'text-to-video', output: 'vertical' },
      { pollIntervalMs: 10, timeoutMs: 1000 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(result.path).toBe('https://cdn.example.com/video.mp4');
  });

  it('stops polling generateVideoAndWait on failure', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce({
          id: 'job-1',
          status: 'pending',
          jobId: 'job-1',
          path: '',
          name: '',
          pollUrl: '/public/v1/generate-video/job-1',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValueOnce({
          id: 'job-1',
          status: 'failed',
          jobId: '',
          path: '',
          name: '',
          pollUrl: '',
          error: 'provider error',
        }),
      } as unknown as Response);

    const client = new Postmill('pm_live_123');
    const result = await client.generateVideoAndWait(
      { type: 'text-to-video', output: 'vertical' },
      { pollIntervalMs: 10, timeoutMs: 1000 }
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('provider error');
  });

  it('returns immediately from generateVideoAndWait when already completed', async () => {
    fetchMock.mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce({
        id: '',
        status: 'completed',
        jobId: '',
        path: 'https://cdn.example.com/video.mp4',
        name: '',
        pollUrl: '',
      }),
    } as unknown as Response);

    const client = new Postmill('pm_live_123');
    const result = await client.generateVideoAndWait(
      { type: 'text-to-video', output: 'vertical' },
      { pollIntervalMs: 10, timeoutMs: 1000 }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
  });

  it('deletes a post by ID', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true } as unknown as Response);

    const client = new Postmill('pm_live_123');
    await client.deletePost('post-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmill.ai/public/v1/posts/post-1');
    expect(init?.method).toBe('DELETE');
  });
});
