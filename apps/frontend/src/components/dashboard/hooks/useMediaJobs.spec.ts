import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaJobs, MediaJobsResponse } from './useMediaJobs';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: vi.fn(),
}));

vi.mock('swr', () => ({
  default: vi.fn(),
}));

const makeResponse = (overrides: Partial<MediaJobsResponse> = {}): MediaJobsResponse => ({
  jobs: [],
  counts: { pending: 0, processing: 0, failed7d: 0 },
  ...overrides,
});

describe('useMediaJobs', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useFetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fetchMock);
  });

  it('returns a loading state before data arrives', () => {
    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useMediaJobs());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('returns media jobs and counts when loaded', () => {
    const data = makeResponse({
      jobs: [
        {
          id: 'job-1',
          provider: 'openai',
          operation: 'image',
          status: 'completed',
          artifactUrl: 'https://example.com/img.png',
          error: null,
          createdAt: '2026-07-06T12:00:00.000Z',
        },
      ],
      counts: { pending: 1, processing: 2, failed7d: 3 },
    });

    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useMediaJobs());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(data);
    expect(result.current.data?.counts).toEqual({ pending: 1, processing: 2, failed7d: 3 });
    expect(result.current.data?.jobs[0].provider).toBe('openai');
  });

  it('returns an empty response without error', () => {
    const data = makeResponse();

    (useSWR as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    const { result } = renderHook(() => useMediaJobs());

    expect(result.current.error).toBeUndefined();
    expect(result.current.data?.jobs).toHaveLength(0);
    expect(result.current.data?.counts).toEqual({ pending: 0, processing: 0, failed7d: 0 });
  });

  it('polls every 5 seconds while at least one job is active', () => {
    let capturedConfig: Record<string, unknown> | undefined;

    (useSWR as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, _load: unknown, config: Record<string, unknown>) => {
        capturedConfig = config;
        return { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() };
      }
    );

    renderHook(() => useMediaJobs());

    expect(capturedConfig).toBeDefined();

    const refreshInterval = capturedConfig!.refreshInterval as (latest?: MediaJobsResponse) => number;

    expect(refreshInterval(undefined)).toBe(0);

    const completedOnly = makeResponse({ jobs: [{ status: 'completed' } as unknown as ReturnType<typeof makeResponse>['jobs'][number]] });
    expect(refreshInterval(completedOnly)).toBe(0);

    const withPending = makeResponse({
      jobs: [
        { status: 'completed' } as unknown as ReturnType<typeof makeResponse>['jobs'][number],
        {
          id: 'job-2',
          provider: 'runway',
          operation: 'video',
          status: 'pending',
          artifactUrl: null,
          error: null,
          createdAt: '2026-07-06T12:00:00.000Z',
        },
      ],
    });
    expect(refreshInterval(withPending)).toBe(5000);

    const withProcessing = makeResponse({
      jobs: [
        {
          id: 'job-3',
          provider: 'luma',
          operation: 'video',
          status: 'processing',
          artifactUrl: null,
          error: null,
          createdAt: '2026-07-06T12:00:00.000Z',
        },
      ],
    });
    expect(refreshInterval(withProcessing)).toBe(5000);
  });

  it('load callback fetches the endpoint and returns parsed JSON', async () => {
    let capturedLoad: ((url: string) => Promise<MediaJobsResponse>) | undefined;
    const payload = makeResponse({ counts: { pending: 5, processing: 0, failed7d: 0 } });

    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });

    (useSWR as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, load: (url: string) => Promise<MediaJobsResponse>) => {
        capturedLoad = load;
        return { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() };
      }
    );

    renderHook(() => useMediaJobs());

    expect(capturedLoad).toBeDefined();
    const result = await capturedLoad!('/dashboard/media-jobs');

    expect(fetchMock).toHaveBeenCalledWith('/dashboard/media-jobs');
    expect(result).toEqual(payload);
  });

  it('load callback throws when the response is not ok', async () => {
    let capturedLoad: ((url: string) => Promise<MediaJobsResponse>) | undefined;

    fetchMock.mockResolvedValue({ ok: false });

    (useSWR as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: unknown, load: (url: string) => Promise<MediaJobsResponse>) => {
        capturedLoad = load;
        return { data: undefined, error: undefined, isLoading: true, mutate: vi.fn() };
      }
    );

    renderHook(() => useMediaJobs());

    await expect(capturedLoad!('/dashboard/media-jobs')).rejects.toThrow(
      'Failed to load media jobs'
    );
    expect(fetchMock).toHaveBeenCalledWith('/dashboard/media-jobs');
  });
});
